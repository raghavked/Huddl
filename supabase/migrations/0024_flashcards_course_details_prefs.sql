-- Huddl schema: the study-tools round. Shared flashcard decks per course
-- (collaborative, with private review state), classmate-editable course
-- details and links, per-kind push preferences, and a weekly digest.

-- 1 · Course details: instructor, meeting times, location — entered by the
-- class, for the class. Shared columns, so edits go through an
-- enrollment-guarded RPC rather than opening UPDATE on courses.
alter table public.courses add column instructor text;
alter table public.courses add column meeting_info text;
alter table public.courses add column location text;

create or replace function public.update_course_details(
  p_course_id uuid, p_instructor text, p_meeting_info text, p_location text
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
  update public.courses
  set instructor   = nullif(trim(coalesce(p_instructor, '')), ''),
      meeting_info = nullif(trim(coalesce(p_meeting_info, '')), ''),
      location     = nullif(trim(coalesce(p_location, '')), '')
  where id = p_course_id;
end;
$$;

comment on function public.update_course_details(uuid, text, text, text) is
  'Classmate-edited course facts (instructor, meeting times, location) — the same user-managed trust model as the course list itself.';

revoke execute on function public.update_course_details(uuid, text, text, text) from public, anon;
grant execute on function public.update_course_details(uuid, text, text, text) to authenticated;

-- 2 · Course links: the syllabus PDF, the textbook, office-hours pages —
-- pinned to the course home by anyone in the class.
create table public.course_links (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  added_by   uuid references public.profiles(id) on delete set null,
  kind       text not null default 'other'
             check (kind in ('syllabus', 'textbook', 'office_hours', 'lecture', 'other')),
  title      text not null check (char_length(title) between 1 and 120),
  url        text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  created_at timestamptz not null default now()
);

create index course_links_course_idx on public.course_links (course_id, created_at);

alter table public.course_links enable row level security;

create policy "classmates can read course links"
  on public.course_links for select
  to authenticated
  using (public.is_enrolled(course_id));

create policy "classmates can add course links"
  on public.course_links for insert
  to authenticated
  with check (added_by = ( SELECT auth.uid() ) and public.is_enrolled(course_id));

create policy "authors can remove their links"
  on public.course_links for delete
  to authenticated
  using (added_by = ( SELECT auth.uid() ));

-- 3 · Flashcards: decks belong to the course and the whole class builds
-- them together; how well YOU know each card stays yours.
create table public.decks (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title      text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now()
);

create index decks_course_idx on public.decks (course_id, created_at);

create table public.cards (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  front      text not null check (char_length(front) between 1 and 1000),
  back       text not null check (char_length(back) between 1 and 2000),
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create index cards_deck_idx on public.cards (deck_id, position, created_at);

create table public.card_reviews (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  card_id    uuid not null references public.cards(id) on delete cascade,
  streak     int not null default 0,
  last_grade text check (last_grade in ('again', 'good', 'easy')),
  due_at     timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create index card_reviews_due_idx on public.card_reviews (user_id, due_at);

comment on table public.decks is
  'Shared flashcard decks, one course each — any classmate contributes cards; deck creators can retire the deck.';
comment on table public.card_reviews is
  'Per-student spaced-repetition state (streak + next due). Private: nobody sees how well you know a card.';

alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.card_reviews enable row level security;

create policy "classmates can read decks"
  on public.decks for select
  to authenticated
  using (public.is_enrolled(course_id));

create policy "classmates can create decks"
  on public.decks for insert
  to authenticated
  with check (created_by = ( SELECT auth.uid() ) and public.is_enrolled(course_id));

create policy "deck creators can rename their decks"
  on public.decks for update
  to authenticated
  using (created_by = ( SELECT auth.uid() ));

create policy "deck creators can delete their decks"
  on public.decks for delete
  to authenticated
  using (created_by = ( SELECT auth.uid() ));

create policy "classmates can read cards"
  on public.cards for select
  to authenticated
  using (exists (select 1 from public.decks d
                 where d.id = deck_id and public.is_enrolled(d.course_id)));

create policy "classmates can add cards"
  on public.cards for insert
  to authenticated
  with check (
    created_by = ( SELECT auth.uid() )
    and exists (select 1 from public.decks d
                where d.id = deck_id and public.is_enrolled(d.course_id))
  );

create policy "card authors can edit their cards"
  on public.cards for update
  to authenticated
  using (created_by = ( SELECT auth.uid() ));

create policy "card authors can remove their cards"
  on public.cards for delete
  to authenticated
  using (created_by = ( SELECT auth.uid() ));

create policy "students manage their own review state"
  on public.card_reviews for all
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

-- 4 · Push preferences: per-kind opt-outs. The in-app inbox always gets
-- everything; only device push respects the prefs.
alter table public.profiles add column notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notification_prefs is
  'Per-kind push opt-outs, e.g. {"dm":"off","event":"off"}. Missing key = on. In-app notifications ignore this; only device push checks it.';

create or replace function public.push_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_messages jsonb;
begin
  -- Respect the recipient's per-kind push preference (missing key = on).
  if exists (
    select 1 from public.profiles p
    where p.id = new.user_id
      and coalesce(p.notification_prefs ->> new.kind, 'on') = 'off'
  ) then
    return new;
  end if;

  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', new.title,
    'body', coalesce(new.body, ''),
    'data', jsonb_build_object('link', coalesce(new.link, '')),
    'sound', 'default'
  ))
  into v_messages
  from public.push_tokens pt
  where pt.user_id = new.user_id;

  if v_messages is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := v_messages
    );
  end if;
  return new;
end;
$$;

-- 5 · The weekly digest: Monday morning, one quiet note per student with
-- due dates ahead — rides the normal notification pipeline (inbox + push).
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.send_weekly_digest()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select e.user_id, 'system',
         'Your week at a glance',
         case
           when count(*) = 1 then '1 due date across your classes this week. The plan has it.'
           else count(*) || ' due dates across your classes this week. The plan has them.'
         end,
         '/plan'
  from public.enrollments e
  join public.course_calendar_items i
    on i.course_id = e.course_id
   and i.due_at >= now()
   and i.due_at < now() + interval '7 days'
  group by e.user_id;
end;
$$;

revoke execute on function public.send_weekly_digest() from public, anon, authenticated;

-- Monday 15:00 UTC ≈ Monday morning on the US West Coast.
select cron.schedule('huddl-weekly-digest', '0 15 * * 1',
                     $$select public.send_weekly_digest()$$);
