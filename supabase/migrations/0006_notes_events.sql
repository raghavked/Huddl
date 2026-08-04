-- Huddl schema: shared notes (files) and events (study sessions + meetups).

create table public.notes (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.courses(id) on delete cascade,
  uploader_id    uuid not null references public.profiles(id) on delete cascade,
  title          text not null,
  description    text,
  storage_path   text not null,
  file_name      text not null,
  file_size      bigint not null default 0,
  mime_type      text,
  download_count int not null default 0,
  created_at     timestamptz not null default now()
);

create index notes_course_idx on public.notes(course_id, created_at desc);

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  course_id     uuid references public.courses(id) on delete set null,
  creator_id    uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('study_session', 'meetup')),
  title         text not null,
  description   text,
  location      text,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  capacity      int check (capacity is null or capacity > 0),
  created_at    timestamptz not null default now(),
  constraint event_time_order check (ends_at is null or ends_at > starts_at)
);

create index events_university_starts_idx on public.events(university_id, starts_at);

create table public.event_rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'going' check (status in ('going', 'maybe', 'declined')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.notes enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

-- Notes are shared with classmates: anyone enrolled in the course can read.
create policy "classmates can read course notes"
  on public.notes for select
  to authenticated
  using (public.is_enrolled(course_id));

create policy "classmates can share notes"
  on public.notes for insert
  to authenticated
  with check (uploader_id = auth.uid() and public.is_enrolled(course_id));

create policy "uploaders can manage own notes"
  on public.notes for update
  to authenticated
  using (uploader_id = auth.uid())
  with check (uploader_id = auth.uid());

create policy "uploaders can delete own notes"
  on public.notes for delete
  to authenticated
  using (uploader_id = auth.uid());

-- Events are campus-wide: visible to everyone at the university.
create policy "events are visible within own university"
  on public.events for select
  to authenticated
  using (university_id = public.current_university_id());

create policy "students can create events at their university"
  on public.events for insert
  to authenticated
  with check (creator_id = auth.uid() and university_id = public.current_university_id());

create policy "creators can update own events"
  on public.events for update
  to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy "creators can delete own events"
  on public.events for delete
  to authenticated
  using (creator_id = auth.uid());

create policy "rsvps are visible with the event"
  on public.event_rsvps for select
  to authenticated
  using (exists (select 1 from public.events e
                 where e.id = event_id
                   and e.university_id = public.current_university_id()));

create policy "students manage own rsvps"
  on public.event_rsvps for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and exists (select 1 from public.events e
                          where e.id = event_id
                            and e.university_id = public.current_university_id()));
