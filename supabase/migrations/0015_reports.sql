-- Huddl schema: content reports — the moderation baseline. Students flag a
-- message (and its author) or a classmate; reports are write-once for the
-- reporter. There are deliberately no update/delete policies: triage lives
-- with admins through the service role, which bypasses RLS.

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles(id) on delete cascade,
  message_id       uuid references public.messages(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reason           text not null check (char_length(reason) between 1 and 500),
  status           text not null default 'open'
                   check (status in ('open', 'reviewed', 'dismissed')),
  created_at       timestamptz not null default now(),
  constraint reports_have_subject
    check (message_id is not null or reported_user_id is not null)
);

-- Triage queue scans newest-first within a status; reporter index backs the
-- own-reports policy and the profile cascade.
create index reports_status_created_idx on public.reports(status, created_at desc);
create index reports_reporter_idx on public.reports(reporter_id);

comment on table public.reports is
  'Student-filed content reports — the moderation queue. Reporter-scoped insert/select via RLS; triage happens through the service role.';
comment on column public.reports.reporter_id is
  'Student who filed the report.';
comment on column public.reports.message_id is
  'Reported channel message, if any. Nulls out if the message row is hard-deleted.';
comment on column public.reports.reported_user_id is
  'Reported student, if any. Message reports set this to the message author so the report keeps a subject after message deletion.';
comment on column public.reports.reason is
  'Reporter-supplied reason, 1–500 characters.';
comment on column public.reports.status is
  'Triage state: open → reviewed | dismissed. Changed only via the service role.';
comment on column public.reports.created_at is
  'When the report was filed.';

alter table public.reports enable row level security;

create policy "students can file reports as themselves"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

create policy "reporters can see their own reports"
  on public.reports for select
  to authenticated
  using (reporter_id = auth.uid());
