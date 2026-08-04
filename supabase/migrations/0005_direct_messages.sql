-- Huddl schema: 1:1 direct messages.
-- Threads are only ever created through the create_dm_thread RPC so both
-- participant rows land atomically; RLS on the tables is read/write-own-thread.

create table public.dm_threads (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.dm_participants (
  thread_id    uuid not null references public.dm_threads(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index dm_participants_user_idx on public.dm_participants(user_id);

create table public.dm_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.dm_threads(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 4000),
  edited_at  timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index dm_messages_thread_created_idx on public.dm_messages(thread_id, created_at desc);

create or replace function public.is_dm_participant(thread uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.dm_participants
    where thread_id = thread and user_id = auth.uid()
  );
$$;

-- Returns the existing thread with the other user, or creates one.
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

alter table public.dm_threads enable row level security;
alter table public.dm_participants enable row level security;
alter table public.dm_messages enable row level security;

create policy "participants can see own threads"
  on public.dm_threads for select
  to authenticated
  using (public.is_dm_participant(id));

create policy "participants can see thread membership"
  on public.dm_participants for select
  to authenticated
  using (user_id = auth.uid() or public.is_dm_participant(thread_id));

create policy "participants can update own read state"
  on public.dm_participants for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "participants can read messages"
  on public.dm_messages for select
  to authenticated
  using (public.is_dm_participant(thread_id));

create policy "participants can send messages"
  on public.dm_messages for insert
  to authenticated
  with check (author_id = auth.uid() and public.is_dm_participant(thread_id));

create policy "authors can edit own dm messages"
  on public.dm_messages for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
