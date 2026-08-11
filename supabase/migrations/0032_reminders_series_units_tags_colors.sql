-- Huddl schema: the study-and-schedule wave.
--
-- Per-assignment reminders on your own lead time, calendar items that can
-- belong to a weekly series, units so a semester estimate can be weighted,
-- tags on shared notes, and a colour each student picks per course.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · Assignment reminders. Opt in per item, choose how far ahead, and an
--     hourly sweep sends exactly one nudge through the normal pipeline.
-- ═══════════════════════════════════════════════════════════════════════

create table public.calendar_reminders (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  item_id      uuid not null references public.course_calendar_items(id) on delete cascade,
  lead_minutes integer not null default 1440
               check (lead_minutes between 15 and 20160),
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  primary key (user_id, item_id)
);

comment on table public.calendar_reminders is
  'A student asking to be reminded about one calendar item. lead_minutes is how far ahead (15 minutes to two weeks); sent_at stamps the one nudge so the sweep never repeats itself.';

create index calendar_reminders_pending_idx
  on public.calendar_reminders (item_id) where sent_at is null;

alter table public.calendar_reminders enable row level security;

create policy "students manage their own reminders"
  on public.calendar_reminders for all
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (
    user_id = ( SELECT auth.uid() )
    and exists (
      select 1
      from public.course_calendar_items i
      join public.enrollments e on e.course_id = i.course_id
      where i.id = item_id and e.user_id = ( SELECT auth.uid() )
    )
  );

create or replace function public.send_calendar_reminders()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  with due as (
    select r.user_id, r.item_id, i.title, i.due_at, c.code
    from public.calendar_reminders r
    join public.course_calendar_items i on i.id = r.item_id
    join public.courses c on c.id = i.course_id
    where r.sent_at is null
      and i.due_at > now()
      and i.due_at <= now() + make_interval(mins => r.lead_minutes)
  ),
  marked as (
    update public.calendar_reminders r
    set sent_at = now()
    from due d
    where r.user_id = d.user_id and r.item_id = d.item_id
    returning r.user_id, r.item_id
  )
  insert into public.notifications (user_id, kind, title, body, link)
  select d.user_id, 'course_calendar',
         d.code || ': ' || d.title,
         'Due ' || to_char(d.due_at at time zone 'America/Los_Angeles',
                           'FMDay FMHH12:MI am') || ' — you asked to be reminded.',
         '/plan'
  from due d
  join marked m on m.user_id = d.user_id and m.item_id = d.item_id;
end;
$$;

revoke execute on function public.send_calendar_reminders() from public, anon, authenticated;

select cron.schedule('huddl-calendar-reminders', '10 * * * *',
                     $$select public.send_calendar_reminders()$$);

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Series. A weekly lecture is many rows that were created together and
--     should be edited or removed together — no recurrence engine, just a
--     shared id the client stamps on every row it generates.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.course_calendar_items add column series_id uuid;

comment on column public.course_calendar_items.series_id is
  'Shared by rows generated from one weekly pattern. Null for a one-off. Editing or deleting "the whole series" filters on this; each row stays an ordinary item otherwise.';

create index course_calendar_series_idx
  on public.course_calendar_items (series_id) where series_id is not null;

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Units, so a semester estimate can be weighted by what each class is
--     worth. Classmate-editable alongside the other course facts.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.courses add column units numeric(3,1)
  check (units is null or (units > 0 and units <= 30));

comment on column public.courses.units is
  'Credit units, kept up by the class like the other course facts. Null means unknown — the semester estimate then treats the course as unweighted and says so.';

create or replace function public.update_course_details(
  p_course_id uuid, p_instructor text, p_meeting_info text,
  p_location text, p_units numeric default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id and e.user_id = v_uid
  ) then
    raise exception 'join the course before editing its details';
  end if;
  if p_units is not null and (p_units <= 0 or p_units > 30) then
    raise exception 'units run 0.5 to 30';
  end if;

  update public.courses
  set instructor   = nullif(trim(coalesce(p_instructor, '')), ''),
      meeting_info = nullif(trim(coalesce(p_meeting_info, '')), ''),
      location     = nullif(trim(coalesce(p_location, '')), ''),
      units        = p_units
  where id = p_course_id;
end;
$$;

comment on function public.update_course_details(uuid, text, text, text, numeric) is
  'Classmate-edited course facts (instructor, meeting times, location, units) — the same user-managed trust model as the course list itself.';

revoke execute on function public.update_course_details(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.update_course_details(uuid, text, text, text, numeric) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · Note tags. Shared, lowercase, few — enough to find the midterm review
--     among forty lecture PDFs.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.notes add column tags text[] not null default '{}'::text[];

comment on column public.notes.tags is
  'Up to five tags on a shared note (lecture, midterm, lab, cheatsheet…). Anyone enrolled reads them; the uploader owns them. Normalized by trigger, so a client can send whatever the student typed.';

create index notes_tags_idx on public.notes using gin (tags);

-- A check constraint cannot hold a subquery, and rejecting "  Midterm " for
-- its capital M would be pedantic anyway. Normalize instead: trim, lowercase,
-- drop the empties and the over-long, dedupe, keep the first five.
create or replace function public.normalize_note_tags()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.tags is null then
    new.tags := '{}'::text[];
    return new;
  end if;
  new.tags := (
    select coalesce(array_agg(t order by ord), '{}'::text[])
    from (
      select lower(trim(tag)) as t, min(ord) as ord
      from unnest(new.tags) with ordinality as u(tag, ord)
      where char_length(trim(tag)) between 2 and 24
      group by lower(trim(tag))
    ) cleaned
  );
  if array_length(new.tags, 1) > 5 then
    new.tags := new.tags[1:5];
  end if;
  return new;
end;
$$;

create trigger notes_tags_normalize
  before insert or update of tags on public.notes
  for each row execute function public.normalize_note_tags();

revoke execute on function public.normalize_note_tags() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5 · Course colours. Personal, not shared: the tint you gave BIS 2A is
--     yours, and your classmate can pick a different one.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.enrollments add column color text
  check (color is null or color in
    ('ember', 'fern', 'clay', 'plum', 'sky', 'sand'));

comment on column public.enrollments.color is
  'The student''s own tint for this course, drawn from the hearth course palette. Null means "let the app choose" — clients derive a stable default from the course code so an unset course still looks deliberate.';
