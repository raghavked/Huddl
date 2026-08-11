-- Huddl schema: the communication wave. Forwarding keeps its provenance,
-- study sessions can be scheduled by asking everyone when they are free,
-- and read receipts and typing indicators become choices.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · Forwarding. A forwarded message is an ordinary message that
--     remembers where it came from. Provenance is denormalized on purpose:
--     a channel message can land in a DM and vice versa, so a foreign key
--     to one table could not describe both directions.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.messages
  add column forwarded_author_id uuid references public.profiles(id) on delete set null,
  add column forwarded_from text check (forwarded_from is null or char_length(forwarded_from) <= 80);

alter table public.dm_messages
  add column forwarded_author_id uuid references public.profiles(id) on delete set null,
  add column forwarded_from text check (forwarded_from is null or char_length(forwarded_from) <= 80);

comment on column public.messages.forwarded_from is
  'Human label for where a forwarded message came from ("#mat-21a", "a direct message"). Set together with forwarded_author_id; both null on an ordinary message.';

create index messages_forwarded_author_idx
  on public.messages (forwarded_author_id) where forwarded_author_id is not null;
create index dm_messages_forwarded_author_idx
  on public.dm_messages (forwarded_author_id) where forwarded_author_id is not null;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Availability polls. "When can everyone meet?" — a handful of
--     candidate times, a yes/maybe/no from each classmate, and the winner
--     becomes an event.
-- ═══════════════════════════════════════════════════════════════════════

create table public.availability_polls (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  closed_at  timestamptz,
  event_id   uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.availability_polls is
  'A "when are you free?" poll living in a channel. event_id is set once the creator turns the winning slot into a real study session.';

create index availability_polls_channel_idx
  on public.availability_polls (channel_id, created_at desc);
create index availability_polls_creator_idx on public.availability_polls (creator_id);

create table public.availability_slots (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.availability_polls(id) on delete cascade,
  starts_at  timestamptz not null,
  position   integer not null default 0
);

create index availability_slots_poll_idx
  on public.availability_slots (poll_id, position, starts_at);

create table public.availability_votes (
  slot_id    uuid not null references public.availability_slots(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  response   text not null check (response in ('yes', 'maybe', 'no')),
  created_at timestamptz not null default now(),
  primary key (slot_id, user_id)
);

create index availability_votes_user_idx on public.availability_votes (user_id);

alter table public.availability_polls enable row level security;
alter table public.availability_slots enable row level security;
alter table public.availability_votes enable row level security;

create policy "members read availability polls"
  on public.availability_polls for select
  to authenticated
  using (public.is_channel_member(channel_id));

create policy "creators close their polls"
  on public.availability_polls for update
  to authenticated
  using (creator_id = ( SELECT auth.uid() ))
  with check (creator_id = ( SELECT auth.uid() ));

create policy "creators remove their polls"
  on public.availability_polls for delete
  to authenticated
  using (creator_id = ( SELECT auth.uid() ));

create policy "members read slots"
  on public.availability_slots for select
  to authenticated
  using (exists (select 1 from public.availability_polls p
                 where p.id = poll_id and public.is_channel_member(p.channel_id)));

create policy "members read votes"
  on public.availability_votes for select
  to authenticated
  using (exists (select 1 from public.availability_slots s
                 join public.availability_polls p on p.id = s.poll_id
                 where s.id = slot_id and public.is_channel_member(p.channel_id)));

create policy "members answer open polls"
  on public.availability_votes for insert
  to authenticated
  with check (
    user_id = ( SELECT auth.uid() )
    and exists (select 1 from public.availability_slots s
                join public.availability_polls p on p.id = s.poll_id
                where s.id = slot_id
                  and p.closed_at is null
                  and public.is_channel_member(p.channel_id))
  );

create policy "students change their own answer"
  on public.availability_votes for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

create policy "students withdraw their own answer"
  on public.availability_votes for delete
  to authenticated
  using (user_id = ( SELECT auth.uid() ));

-- Poll + slots + the carrying chat message, atomically — same shape as
-- create_poll, so the two feel like siblings in the composer.
create or replace function public.create_availability_poll(
  p_channel_id uuid, p_title text, p_slots timestamptz[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_poll_id uuid;
  v_slot timestamptz;
  v_pos int := 0;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_channel_member(p_channel_id) then
    raise exception 'join the channel first';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 120 then
    raise exception 'give the poll a short title';
  end if;
  if p_slots is null or array_length(p_slots, 1) not between 2 and 8 then
    raise exception 'offer 2-8 times';
  end if;

  insert into public.availability_polls (channel_id, creator_id, title)
  values (p_channel_id, v_uid, trim(p_title))
  returning id into v_poll_id;

  foreach v_slot in array p_slots loop
    insert into public.availability_slots (poll_id, starts_at, position)
    values (v_poll_id, v_slot, v_pos);
    v_pos := v_pos + 1;
  end loop;

  insert into public.messages (channel_id, author_id, content)
  values (p_channel_id, v_uid, 'When can everyone meet? ' || trim(p_title));

  return v_poll_id;
end;
$$;

comment on function public.create_availability_poll(uuid, text, timestamptz[]) is
  'Creates a when-are-you-free poll with 2-8 candidate times plus the chat message announcing it. Returns the poll id.';

revoke execute on function public.create_availability_poll(uuid, text, timestamptz[]) from public, anon;
grant execute on function public.create_availability_poll(uuid, text, timestamptz[]) to authenticated;

alter publication supabase_realtime add table public.availability_votes;

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Read receipts and typing, as choices. Both default on — that is how
--     the app has always behaved — and both are one-way: turn read
--     receipts off and you stop seeing other people's too, because a
--     one-sided view of who has read what is a trap, not a feature.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column share_read_receipts boolean not null default true,
  add column share_typing boolean not null default true;

comment on column public.profiles.share_read_receipts is
  'When false, this student''s read state is not shown to others — and clients hide everyone else''s from them in return. Reciprocal by design.';
comment on column public.profiles.share_typing is
  'When false, this student never broadcasts a typing indicator. Reciprocal in the same way.';
