-- Huddl schema: the course "server". A course stops being one channel and
-- becomes a home with rooms (general, lectures, notes, discussion, study
-- groups, custom), a shared class calendar imported from the syllabus, and
-- per-student study check-offs that power the personal study plan.

-- 1 · Rooms: many channels per course. The original channel stays the main
-- room; extra rooms are regular course channels with is_main = false.
alter table public.channels add column is_main boolean not null default true;

alter table public.channels drop constraint channels_course_id_key;
create unique index channels_course_main_key
  on public.channels (course_id) where is_main;

comment on column public.channels.is_main is
  'The course''s front room. Extra rooms (lectures, study groups, …) are course channels with is_main = false.';

-- Enrolled students spin up rooms; definer so the insert clears channel RLS,
-- guarded to the caller's own enrollment.
create or replace function public.create_course_room(p_course_id uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course public.courses;
  v_slug text;
  v_channel_id uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 40 then
    raise exception 'room names run 2-40 characters';
  end if;

  select c.* into v_course from public.courses c where c.id = p_course_id;
  if not found then
    raise exception 'course not found';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id and e.user_id = v_uid
  ) then
    raise exception 'join the course before adding rooms';
  end if;

  v_slug := lower(replace(v_course.code, ' ', '-')) || '-' ||
            regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);

  insert into public.channels
    (university_id, course_id, kind, name, slug, description, created_by, is_main)
  values
    (v_course.university_id, p_course_id, 'course', trim(p_name), v_slug,
     trim(p_name) || ' — ' || v_course.code, v_uid, false)
  returning id into v_channel_id;

  insert into public.channel_members (channel_id, user_id)
  values (v_channel_id, v_uid)
  on conflict do nothing;

  return v_channel_id;
end;
$$;

comment on function public.create_course_room(uuid, text) is
  'Adds a room to a course (lectures, study group, …) for an enrolled student and joins them. Classmates join via the standard membership policy.';

revoke execute on function public.create_course_room(uuid, text) from public, anon;
grant execute on function public.create_course_room(uuid, text) to authenticated;

-- 2 · The class calendar: assignments, exams, lectures — imported from the
-- syllabus or added by hand, shared by everyone in the course.
create table public.course_calendar_items (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  kind       text not null check (kind in ('assignment', 'exam', 'quiz', 'lecture', 'reading', 'project', 'other')),
  title      text not null check (char_length(title) between 1 and 200),
  details    text,
  due_at     timestamptz not null,
  source     text not null default 'manual' check (source in ('manual', 'syllabus')),
  created_at timestamptz not null default now()
);

comment on table public.course_calendar_items is
  'The shared class calendar: due dates, exams, lectures — syllabus-imported or hand-added by classmates.';

create index course_calendar_course_due_idx
  on public.course_calendar_items (course_id, due_at);

alter table public.course_calendar_items enable row level security;

create policy "classmates can read the course calendar"
  on public.course_calendar_items for select
  to authenticated
  using (exists (
    select 1 from public.enrollments e
    where e.course_id = course_calendar_items.course_id and e.user_id = auth.uid()
  ));

create policy "classmates can add calendar items"
  on public.course_calendar_items for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.enrollments e
      where e.course_id = course_calendar_items.course_id and e.user_id = auth.uid()
    )
  );

create policy "authors can edit their calendar items"
  on public.course_calendar_items for update
  to authenticated
  using (created_by = auth.uid());

create policy "authors can remove their calendar items"
  on public.course_calendar_items for delete
  to authenticated
  using (created_by = auth.uid());

-- 3 · Syllabus import audit (parsing happens on-device; only the outcome is
-- recorded — no syllabus text is stored).
create table public.syllabus_imports (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  item_count integer not null check (item_count >= 0),
  created_at timestamptz not null default now()
);

comment on table public.syllabus_imports is
  'One row per syllabus import: who brought the class calendar in, and how many items it produced. The document itself never leaves the device.';

alter table public.syllabus_imports enable row level security;

create policy "classmates can see who imported the syllabus"
  on public.syllabus_imports for select
  to authenticated
  using (exists (
    select 1 from public.enrollments e
    where e.course_id = syllabus_imports.course_id and e.user_id = auth.uid()
  ));

create policy "importers record their own imports"
  on public.syllabus_imports for insert
  to authenticated
  with check (user_id = auth.uid());

-- 4 · Study check-offs: the personal layer over the shared calendar — what
-- you've handled, so the study plan can show you're on top of it.
create table public.study_checkoffs (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  item_id    uuid not null references public.course_calendar_items(id) on delete cascade,
  done_at    timestamptz not null default now(),
  primary key (user_id, item_id)
);

comment on table public.study_checkoffs is
  'Per-student done marks on calendar items — private progress powering the study plan.';

alter table public.study_checkoffs enable row level security;

create policy "students manage their own check-offs"
  on public.study_checkoffs for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 5 · Notifications: a new kind, and classmates hear when the class calendar
-- grows (syllabus import lands once as a summary via the app, per-item
-- notifications only for hand-added items to avoid a 40-row burst).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('dm', 'thread_reply', 'schedule_privacy', 'event', 'channel', 'system', 'course_calendar'));

create or replace function public.notify_course_calendar_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  if new.source <> 'manual' then
    return new; -- syllabus imports announce themselves once, in-app
  end if;
  select c.code into v_code from public.courses c where c.id = new.course_id;
  insert into public.notifications (user_id, kind, title, body, link)
  select e.user_id, 'course_calendar',
         v_code || ': ' || new.title,
         case new.kind
           when 'exam' then 'New exam on the class calendar'
           when 'quiz' then 'New quiz on the class calendar'
           when 'assignment' then 'New assignment on the class calendar'
           else 'New date on the class calendar'
         end,
         '/courses/' || new.course_id
  from public.enrollments e
  where e.course_id = new.course_id
    and e.user_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000');
  return new;
end;
$$;

create trigger course_calendar_item_notify
  after insert on public.course_calendar_items
  for each row execute function public.notify_course_calendar_item();
