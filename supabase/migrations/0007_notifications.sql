-- Huddl schema: notifications, fed by database triggers so product guarantees
-- (like schedule-image privacy notices) hold no matter which client writes.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in
             ('dm', 'thread_reply', 'schedule_privacy', 'event', 'channel', 'system')),
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- Optional profile trust signal: students may verify a mobile number and get
-- a "verified" badge. Kept as a helper so future features can gate on it.
create or replace function public.has_verified_phone()
returns boolean
language sql stable security definer set search_path = public
as $$
  select phone_verified_at is not null from public.profiles where id = auth.uid();
$$;

-- Privacy requirement: every audit event on a stored schedule image becomes a
-- user-facing notification, guaranteed by the database.
create or replace function public.notify_schedule_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.schedule_uploads where id = new.upload_id;
  insert into public.notifications (user_id, kind, title, body, link)
  values (
    owner,
    'schedule_privacy',
    case new.event_type
      when 'uploaded' then 'Schedule image uploaded'
      when 'processed_on_device' then 'Schedule image processed on your device'
      when 'stored' then 'Schedule image stored'
      when 'accessed' then 'Your stored schedule image was accessed'
      when 'courses_confirmed' then 'Courses confirmed from your schedule'
      when 'deleted' then 'Schedule image deleted'
    end,
    coalesce(new.detail, ''),
    '/settings/privacy'
  );
  return new;
end;
$$;

create trigger on_schedule_event_notify
  after insert on public.schedule_upload_events
  for each row execute function public.notify_schedule_event();

-- DMs generate a notification for the other participant.
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
  where p.thread_id = new.thread_id and p.user_id <> new.author_id;
  return new;
end;
$$;

create trigger on_dm_message_notify
  after insert on public.dm_messages
  for each row execute function public.notify_dm_message();

-- Thread replies notify the parent-message author.
create or replace function public.notify_thread_reply()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  parent_author uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  select author_id into parent_author from public.messages where id = new.parent_id;
  if parent_author is not null and parent_author <> new.author_id then
    insert into public.notifications (user_id, kind, title, body, link)
    select parent_author, 'thread_reply',
           pr.display_name || ' replied to your message',
           left(new.content, 140),
           '/channels/' || new.channel_id || '?thread=' || new.parent_id
    from public.profiles pr where pr.id = new.author_id;
  end if;
  return new;
end;
$$;

create trigger on_thread_reply_notify
  after insert on public.messages
  for each row execute function public.notify_thread_reply();

alter table public.notifications enable row level security;

create policy "users read own notifications"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "users can mark notifications read"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
