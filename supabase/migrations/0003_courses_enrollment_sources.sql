-- Huddl schema: courses, enrollments, and the two enrollment sources
-- (Canvas connections and schedule-image uploads with a privacy audit trail).

create table public.courses (
  id               uuid primary key default gen_random_uuid(),
  university_id    uuid not null references public.universities(id) on delete cascade,
  term_id          uuid references public.terms(id) on delete set null,
  code             text not null,
  title            text not null,
  canvas_course_id bigint,
  created_at       timestamptz not null default now(),
  unique (university_id, term_id, code)
);

create index courses_university_idx on public.courses(university_id);

create table public.enrollments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  role       text not null default 'student' check (role in ('student', 'ta', 'instructor')),
  source     text not null check (source in ('canvas', 'schedule_image', 'manual')),
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);

create index enrollments_course_idx on public.enrollments(course_id);

create table public.canvas_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references public.profiles(id) on delete cascade,
  base_url       text not null,
  -- Personal access token for the Canvas REST API. Readable only by the owner
  -- via RLS; move to Supabase Vault / pgsodium before public launch.
  access_token   text not null,
  last_synced_at timestamptz,
  sync_status    text not null default 'never' check (sync_status in ('never', 'ok', 'error')),
  sync_error     text,
  created_at     timestamptz not null default now()
);

-- Schedule-image fallback. The image itself lives in the private "schedules"
-- storage bucket; OCR happens on-device in the browser. Every touch of the
-- stored image is appended to schedule_upload_events, and a trigger turns
-- those into user-facing notifications — the "users must be notified when"
-- requirement is enforced at the database layer, not left to app code.
create table public.schedule_uploads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'processed', 'confirmed', 'deleted')),
  ocr_summary  jsonb,
  created_at   timestamptz not null default now()
);

create table public.schedule_upload_events (
  id         uuid primary key default gen_random_uuid(),
  upload_id  uuid not null references public.schedule_uploads(id) on delete cascade,
  event_type text not null check (event_type in
             ('uploaded', 'processed_on_device', 'stored', 'accessed', 'courses_confirmed', 'deleted')),
  detail     text,
  created_at timestamptz not null default now()
);

create index schedule_upload_events_upload_idx on public.schedule_upload_events(upload_id);

-- Helper used by roster/notes policies: is the signed-in user enrolled in a course?
create or replace function public.is_enrolled(course uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.enrollments
    where course_id = course and user_id = auth.uid()
  );
$$;

alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.canvas_connections enable row level security;
alter table public.schedule_uploads enable row level security;
alter table public.schedule_upload_events enable row level security;

create policy "courses are readable within own university"
  on public.courses for select
  to authenticated
  using (university_id = public.current_university_id());

-- Canvas sync and manual add both create course rows client-side under the
-- user's own university.
create policy "students can add courses at their university"
  on public.courses for insert
  to authenticated
  with check (university_id = public.current_university_id());

create policy "students see own enrollments and classmates"
  on public.enrollments for select
  to authenticated
  using (user_id = auth.uid() or public.is_enrolled(course_id));

create policy "students manage own enrollments"
  on public.enrollments for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "students can drop own enrollments"
  on public.enrollments for delete
  to authenticated
  using (user_id = auth.uid());

create policy "users manage own canvas connection"
  on public.canvas_connections for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users manage own schedule uploads"
  on public.schedule_uploads for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users read own schedule upload events"
  on public.schedule_upload_events for select
  to authenticated
  using (exists (select 1 from public.schedule_uploads u
                 where u.id = upload_id and u.user_id = auth.uid()));

create policy "users append own schedule upload events"
  on public.schedule_upload_events for insert
  to authenticated
  with check (exists (select 1 from public.schedule_uploads u
                      where u.id = upload_id and u.user_id = auth.uid()));
