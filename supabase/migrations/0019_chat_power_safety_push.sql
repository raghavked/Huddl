-- Huddl schema: the chat-power + safety + push round. Channels grow polls,
-- @mentions, pinned messages, and image attachments (DMs too); students get
-- real blocking (App Store UGC baseline); notifications gain device push
-- delivery through Expo's push API via pg_net.

-- 1 · Attachments: channel messages have had attachment_path since 0004 —
-- give DMs the same column, and a private bucket for chat images.
alter table public.dm_messages add column attachment_path text;

insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', false)
on conflict (id) do nothing;

create policy "authenticated users can read chat uploads"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'chat-uploads');

create policy "users upload chat files to own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users delete own chat files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2 · Blocks: one-way, private to the blocker. The blocked person never
-- learns; the app hides their content from you and DMs refuse both ways.
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

comment on table public.blocks is
  'Student-managed blocks. Content filtering is client-side off this list; DM creation and notifications check it server-side.';

alter table public.blocks enable row level security;

create policy "students manage their own block list"
  on public.blocks for all
  to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- Shared guard for RPCs and triggers (definer: blocks rows are private).
create or replace function public.is_blocked_either(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke execute on function public.is_blocked_either(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_either(uuid, uuid) to authenticated;

-- DMs refuse to open across a block, in either direction.
create or replace function public.create_dm_thread(other_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  thread uuid;
begin
  if other_user = auth.uid() then
    raise exception 'Cannot start a DM with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'No such user';
  end if;
  if public.is_blocked_either(auth.uid(), other_user) then
    raise exception 'You can''t message this person';
  end if;

  select p1.thread_id into thread
  from public.dm_participants p1
  join public.dm_participants p2 on p1.thread_id = p2.thread_id
  where p1.user_id = auth.uid() and p2.user_id = other_user;

  if thread is null then
    insert into public.dm_threads default values returning id into thread;
    insert into public.dm_participants (thread_id, user_id)
    values (thread, auth.uid()), (thread, other_user);
  end if;
  return thread;
end;
$$;

-- DM notifications stay quiet across a block (old threads may still exist).
create or replace function public.notify_dm_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select p.user_id, 'dm',
         'New message from ' || pr.display_name,
         left(new.content, 140),
         '/messages/' || new.thread_id
  from public.dm_participants p
  join public.profiles pr on pr.id = new.author_id
  where p.thread_id = new.thread_id
    and p.user_id <> new.author_id
    and not public.is_blocked_either(p.user_id, new.author_id);
  return new;
end;
$$;

-- 3 · Polls: a poll is a message with a poll_id — it lives in the chat
-- stream. Single choice per student, revotable until the creator closes it.
create table public.polls (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  question   text not null check (char_length(question) between 1 and 300),
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

create table public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls(id) on delete cascade,
  label    text not null check (char_length(label) between 1 and 100),
  position int not null default 0
);

create index poll_options_poll_idx on public.poll_options(poll_id, position);

create table public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index poll_votes_option_idx on public.poll_votes(option_id);

alter table public.messages add column poll_id uuid references public.polls(id) on delete set null;

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

create policy "members can read channel polls"
  on public.polls for select
  to authenticated
  using (public.is_channel_member(channel_id));

create policy "creators can close their polls"
  on public.polls for update
  to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy "members can read poll options"
  on public.poll_options for select
  to authenticated
  using (exists (select 1 from public.polls p
                 where p.id = poll_id and public.is_channel_member(p.channel_id)));

create policy "members can read poll votes"
  on public.poll_votes for select
  to authenticated
  using (exists (select 1 from public.polls p
                 where p.id = poll_id and public.is_channel_member(p.channel_id)));

create policy "members vote on open polls"
  on public.poll_votes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.polls p
                where p.id = poll_id
                  and p.closed_at is null
                  and public.is_channel_member(p.channel_id))
  );

create policy "voters can change their vote"
  on public.poll_votes for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.polls p
                where p.id = poll_id and p.closed_at is null)
  );

create policy "voters can retract their vote"
  on public.poll_votes for delete
  to authenticated
  using (user_id = auth.uid());

-- Poll + options + the carrying message, atomically.
create or replace function public.create_poll(
  p_channel_id uuid, p_question text, p_options text[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_poll_id uuid;
  v_message_id uuid;
  v_label text;
  v_pos int := 0;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_channel_member(p_channel_id) then
    raise exception 'join the channel first';
  end if;
  if p_question is null or char_length(trim(p_question)) not between 1 and 300 then
    raise exception 'poll questions run 1-300 characters';
  end if;
  if p_options is null or array_length(p_options, 1) not between 2 and 8 then
    raise exception 'polls take 2-8 options';
  end if;

  insert into public.polls (channel_id, creator_id, question)
  values (p_channel_id, v_uid, trim(p_question))
  returning id into v_poll_id;

  foreach v_label in array p_options loop
    if char_length(trim(v_label)) between 1 and 100 then
      insert into public.poll_options (poll_id, label, position)
      values (v_poll_id, trim(v_label), v_pos);
      v_pos := v_pos + 1;
    end if;
  end loop;

  if v_pos < 2 then
    raise exception 'polls take 2-8 options';
  end if;

  insert into public.messages (channel_id, author_id, content, poll_id)
  values (p_channel_id, v_uid, trim(p_question), v_poll_id)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

comment on function public.create_poll(uuid, text, text[]) is
  'Creates a poll and the chat message that carries it, atomically. Returns the message id.';

revoke execute on function public.create_poll(uuid, text, text[]) from public, anon;
grant execute on function public.create_poll(uuid, text, text[]) to authenticated;

-- 4 · Pinned messages: any member can pin — campus rooms are small and
-- self-governing. Definer RPC because authors-only UPDATE RLS is narrower.
alter table public.messages add column pinned_at timestamptz;
alter table public.messages add column pinned_by uuid references public.profiles(id) on delete set null;

create index messages_pinned_idx
  on public.messages (channel_id, pinned_at desc) where pinned_at is not null;

create or replace function public.set_message_pinned(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_channel uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  select channel_id into v_channel
  from public.messages
  where id = p_message_id and deleted_at is null;
  if v_channel is null then
    raise exception 'message not found';
  end if;
  if not public.is_channel_member(v_channel) then
    raise exception 'join the channel first';
  end if;

  update public.messages
  set pinned_at = case when p_pinned then now() else null end,
      pinned_by = case when p_pinned then v_uid else null end
  where id = p_message_id;
end;
$$;

revoke execute on function public.set_message_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_message_pinned(uuid, boolean) to authenticated;

-- 5 · @Mentions: a new notification kind, raised by trigger when a message
-- names a channel member's handle. Blocks silence it both ways.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('dm', 'thread_reply', 'schedule_privacy', 'event', 'channel',
                  'system', 'course_calendar', 'mention'));

create or replace function public.notify_mentions()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_channel_name text;
  v_author_name text;
begin
  if new.deleted_at is not null or position('@' in new.content) = 0 then
    return new;
  end if;
  select name into v_channel_name from public.channels where id = new.channel_id;
  select display_name into v_author_name from public.profiles where id = new.author_id;

  insert into public.notifications (user_id, kind, title, body, link)
  select distinct p.id, 'mention',
         v_author_name || ' mentioned you',
         'In #' || v_channel_name || ': ' || left(new.content, 140),
         '/channels/' || new.channel_id
  from regexp_matches(lower(new.content), '@([a-z0-9_]{3,24})', 'g') m
  join public.profiles p on p.handle = m[1]
  join public.channel_members cm
    on cm.channel_id = new.channel_id and cm.user_id = p.id
  where p.id <> new.author_id
    and not public.is_blocked_either(p.id, new.author_id);
  return new;
end;
$$;

create trigger on_message_mentions_notify
  after insert on public.messages
  for each row execute function public.notify_mentions();

-- 6 · Device push: Expo push tokens per device, and best-effort delivery of
-- every notification row through pg_net (async, never blocks the insert).
create table public.push_tokens (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  token      text not null check (char_length(token) between 10 and 400),
  platform   text not null default 'unknown' check (platform in ('ios', 'android', 'unknown')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

comment on table public.push_tokens is
  'Expo push tokens, one row per signed-in device. Delivery fans out from the notifications insert trigger.';

alter table public.push_tokens enable row level security;

create policy "users manage their own push tokens"
  on public.push_tokens for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create extension if not exists pg_net with schema extensions;

create or replace function public.push_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', new.title,
    'body', coalesce(new.body, ''),
    'data', jsonb_build_object('link', coalesce(new.link, '')),
    'sound', 'default'
  ))
  into v_messages
  from public.push_tokens pt
  where pt.user_id = new.user_id;

  if v_messages is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := v_messages
    );
  end if;
  return new;
end;
$$;

create trigger on_notification_push
  after insert on public.notifications
  for each row execute function public.push_notification();

-- 7 · Realtime: poll results move live.
alter publication supabase_realtime add table public.poll_votes;
alter publication supabase_realtime add table public.polls;
