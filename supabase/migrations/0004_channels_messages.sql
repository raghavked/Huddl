-- Huddl schema: chat channels, membership, messages (with threading), reactions.
-- Channels come in three kinds:
--   campus — university-wide community channels (the Discord × YikYak surface),
--            auto-joined at signup when is_default = true
--   course — one per course, auto-created + auto-joined on enrollment
--   topic  — student-created interest channels, browse & join

create table public.channels (
  id            uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  course_id     uuid unique references public.courses(id) on delete cascade,
  kind          text not null check (kind in ('campus', 'course', 'topic')),
  name          text not null,
  slug          text not null,
  description   text,
  is_default    boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (university_id, slug),
  constraint course_channels_have_course check ((kind = 'course') = (course_id is not null))
);

create table public.channel_members (
  channel_id   uuid not null references public.channels(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('member', 'moderator')),
  muted        boolean not null default false,
  last_read_at timestamptz not null default now(),
  joined_at    timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index channel_members_user_idx on public.channel_members(user_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references public.channels(id) on delete cascade,
  author_id       uuid not null references public.profiles(id) on delete cascade,
  parent_id       uuid references public.messages(id) on delete cascade,
  content         text not null check (char_length(content) between 1 and 4000),
  attachment_path text,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index messages_channel_created_idx on public.messages(channel_id, created_at desc);
create index messages_parent_idx on public.messages(parent_id) where parent_id is not null;

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- SECURITY DEFINER membership check — policies on channel_members and
-- messages both need it, and calling it (rather than subquerying
-- channel_members inside its own policy) is what avoids RLS recursion.
create or replace function public.is_channel_member(channel uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = channel and user_id = auth.uid()
  );
$$;

create or replace function public.channel_university(channel uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select university_id from public.channels where id = channel;
$$;

-- Auto-create the course channel and join the student the moment an
-- enrollment lands (from Canvas sync, schedule confirm, or manual add).
create or replace function public.handle_new_enrollment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  chan_id uuid;
  c record;
begin
  select * into c from public.courses where id = new.course_id;
  select id into chan_id from public.channels where course_id = new.course_id;
  if chan_id is null then
    insert into public.channels (university_id, course_id, kind, name, slug, description)
    values (
      c.university_id,
      new.course_id,
      'course',
      c.code,
      regexp_replace(lower(c.code || '-' || substr(new.course_id::text, 1, 8)), '[^a-z0-9-]', '-', 'g'),
      c.title
    )
    returning id into chan_id;
  end if;
  insert into public.channel_members (channel_id, user_id)
  values (chan_id, new.user_id)
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_enrollment_created
  after insert on public.enrollments
  for each row execute function public.handle_new_enrollment();

-- Leaving a course removes the matching channel membership.
create or replace function public.handle_enrollment_deleted()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.channel_members cm
  using public.channels ch
  where ch.course_id = old.course_id
    and cm.channel_id = ch.id
    and cm.user_id = old.user_id;
  return old;
end;
$$;

create trigger on_enrollment_deleted
  after delete on public.enrollments
  for each row execute function public.handle_enrollment_deleted();

-- New students land in their campus's default channels automatically.
create or replace function public.join_default_campus_channels()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.channel_members (channel_id, user_id)
  select id, new.id from public.channels
  where university_id = new.university_id and kind = 'campus' and is_default
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_profile_created_join_campus
  after insert on public.profiles
  for each row execute function public.join_default_campus_channels();

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

create policy "channels are visible within own university"
  on public.channels for select
  to authenticated
  using (university_id = public.current_university_id());

create policy "students can create topic channels at their university"
  on public.channels for insert
  to authenticated
  with check (
    kind = 'topic'
    and university_id = public.current_university_id()
    and created_by = auth.uid()
  );

create policy "channel members are visible to fellow members"
  on public.channel_members for select
  to authenticated
  using (user_id = auth.uid() or public.is_channel_member(channel_id));

create policy "students can join channels at their university"
  on public.channel_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.channel_university(channel_id) = public.current_university_id()
  );

create policy "members can update own membership"
  on public.channel_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "members can leave channels"
  on public.channel_members for delete
  to authenticated
  using (user_id = auth.uid());

create policy "members can read channel messages"
  on public.messages for select
  to authenticated
  using (public.is_channel_member(channel_id));

create policy "members can post channel messages"
  on public.messages for insert
  to authenticated
  with check (author_id = auth.uid() and public.is_channel_member(channel_id));

create policy "authors can edit own messages"
  on public.messages for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "members can read reactions"
  on public.message_reactions for select
  to authenticated
  using (exists (select 1 from public.messages m
                 where m.id = message_id and public.is_channel_member(m.channel_id)));

create policy "members can react"
  on public.message_reactions for insert
  to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.messages m
                          where m.id = message_id and public.is_channel_member(m.channel_id)));

create policy "users can remove own reactions"
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid());
