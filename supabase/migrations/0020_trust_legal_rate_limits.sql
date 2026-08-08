-- Huddl schema: the trust round. Terms acceptance lands on the profile,
-- reports gain triage categories, and posting gets a gentle server-side
-- rate limit — the backstop that keeps spam floods off small campus rooms.

-- 1 · Terms of service acceptance, stamped at signup (and re-stamped when
-- the terms version changes — the app compares against TERMS_VERSION).
alter table public.profiles add column accepted_terms_at timestamptz;

comment on column public.profiles.accepted_terms_at is
  'When the student last accepted the Terms of Service and Community Guidelines. Null only for accounts predating the terms flow.';

-- 2 · Report categories: free-text reasons stay, but a category makes the
-- triage queue sortable and App Store review happy.
alter table public.reports add column category text not null default 'other'
  check (category in ('harassment', 'spam', 'hate', 'impersonation',
                      'sexual_content', 'self_harm', 'academic_dishonesty', 'other'));

comment on column public.reports.category is
  'Reporter-picked category. Triage sorts by this before reading reasons.';

-- 3 · Rate limits: at most 30 posts per rolling minute per author, channels
-- and DMs alike. Generous for humans, a wall for scripts.
create index messages_author_created_idx
  on public.messages (author_id, created_at desc);
create index dm_messages_author_created_idx
  on public.dm_messages (author_id, created_at desc);

create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.messages
  where author_id = new.author_id
    and created_at > now() - interval '60 seconds';
  if v_recent >= 30 then
    raise exception 'Whoa — that''s a lot of messages. Give it a minute.';
  end if;
  return new;
end;
$$;

create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

create or replace function public.enforce_dm_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.dm_messages
  where author_id = new.author_id
    and created_at > now() - interval '60 seconds';
  if v_recent >= 30 then
    raise exception 'Whoa — that''s a lot of messages. Give it a minute.';
  end if;
  return new;
end;
$$;

create trigger dm_messages_rate_limit
  before insert on public.dm_messages
  for each row execute function public.enforce_dm_rate_limit();

-- 4 · Report throughput guard: ten reports per hour is plenty for a human.
create index reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);

create or replace function public.enforce_report_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.reports
  where reporter_id = new.reporter_id
    and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'You''ve filed a lot of reports this hour — we''re on it. Try again later.';
  end if;
  return new;
end;
$$;

create trigger reports_rate_limit
  before insert on public.reports
  for each row execute function public.enforce_report_rate_limit();
