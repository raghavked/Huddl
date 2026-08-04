-- Huddl schema: clubs & student organizations (Band-style groups).
-- A club is a member-run space: roster, its own chat channel (auto-created),
-- and club events. Any student can found one at their university.

create table public.clubs (
  id            uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name          text not null,
  slug          text not null,
  description   text,
  category      text not null default 'other' check (category in
                ('academic', 'professional', 'cultural', 'sports', 'social', 'service', 'other')),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (university_id, slug)
);

create table public.club_members (
  club_id   uuid not null references public.clubs(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('member', 'officer', 'owner')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create index club_members_user_idx on public.club_members(user_id);

-- Club channels ride the existing channel machinery.
alter table public.channels add column club_id uuid unique references public.clubs(id) on delete cascade;
alter table public.channels drop constraint channels_kind_check;
alter table public.channels add constraint channels_kind_check
  check (kind in ('campus', 'course', 'topic', 'club'));
alter table public.channels add constraint club_channels_have_club
  check ((kind = 'club') = (club_id is not null));

create or replace function public.club_university(club uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select university_id from public.clubs where id = club;
$$;

create or replace function public.is_club_officer(club uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = club and user_id = auth.uid() and role in ('officer', 'owner')
  );
$$;

-- Founding a club creates its channel and makes the founder the owner.
create or replace function public.handle_new_club()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.channels (university_id, club_id, kind, name, slug, description)
  values (
    new.university_id,
    new.id,
    'club',
    new.name,
    'club-' || new.slug,
    coalesce(new.description, new.name)
  );
  if new.created_by is not null then
    insert into public.club_members (club_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_club_created
  after insert on public.clubs
  for each row execute function public.handle_new_club();

-- Club membership mirrors into the club's channel.
create or replace function public.handle_club_member_added()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.channel_members (channel_id, user_id)
  select id, new.user_id from public.channels where club_id = new.club_id
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_club_member_added
  after insert on public.club_members
  for each row execute function public.handle_club_member_added();

create or replace function public.handle_club_member_removed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.channel_members cm
  using public.channels ch
  where ch.club_id = old.club_id
    and cm.channel_id = ch.id
    and cm.user_id = old.user_id;
  return old;
end;
$$;

create trigger on_club_member_removed
  after delete on public.club_members
  for each row execute function public.handle_club_member_removed();

-- Clubs can host events.
alter table public.events add column club_id uuid references public.clubs(id) on delete cascade;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;

create policy "clubs are visible within own university"
  on public.clubs for select
  to authenticated
  using (university_id = public.current_university_id());

create policy "students can found clubs at their university"
  on public.clubs for insert
  to authenticated
  with check (created_by = auth.uid() and university_id = public.current_university_id());

create policy "officers can update their club"
  on public.clubs for update
  to authenticated
  using (public.is_club_officer(id))
  with check (public.is_club_officer(id));

create policy "owners can disband their club"
  on public.clubs for delete
  to authenticated
  using (exists (select 1 from public.club_members
                 where club_id = id and user_id = auth.uid() and role = 'owner'));

create policy "club rosters are visible within own university"
  on public.club_members for select
  to authenticated
  using (public.club_university(club_id) = public.current_university_id());

create policy "students can join clubs at their university"
  on public.club_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.club_university(club_id) = public.current_university_id()
  );

create policy "officers can manage roles"
  on public.club_members for update
  to authenticated
  using (public.is_club_officer(club_id))
  with check (public.is_club_officer(club_id));

create policy "members can leave clubs"
  on public.club_members for delete
  to authenticated
  using (user_id = auth.uid() or public.is_club_officer(club_id));
