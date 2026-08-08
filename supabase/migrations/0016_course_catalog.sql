-- Huddl schema: the verified course catalog. Students self-input courses
-- against a per-university catalog of real offerings (structured after UC
-- Davis's public course data as presented by community catalogs like
-- Cattlelog / AggieWorks), so a manual enrollment can be *verified* — the
-- code, title, and this-term availability all come from the catalog row,
-- not from free text. Free-text stays possible but stays marked unverified.

create table public.catalog_courses (
  id            uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  subject_code  text not null check (subject_code = upper(subject_code) and char_length(subject_code) between 2 and 8),
  course_number text not null check (char_length(course_number) between 1 and 8),
  title         text not null check (char_length(title) between 1 and 200),
  units         numeric(3, 1),
  description   text,
  unique (university_id, subject_code, course_number)
);

comment on table public.catalog_courses is
  'Per-university course catalog: the source of truth self-input enrollments verify against. Seeded from public registrar data; refreshable per term.';
comment on column public.catalog_courses.subject_code is
  'Uppercase subject prefix, e.g. MAT, ECS, CHE.';
comment on column public.catalog_courses.course_number is
  'Course number as printed, e.g. 21A, 154, 101.';

create index catalog_courses_search_idx
  on public.catalog_courses (university_id, subject_code, course_number);

create table public.catalog_offerings (
  id                uuid not null primary key default gen_random_uuid(),
  catalog_course_id uuid not null references public.catalog_courses(id) on delete cascade,
  term_id           uuid not null references public.terms(id) on delete cascade,
  source            text not null default 'seed'
                    check (source in ('seed', 'registrar', 'community')),
  unique (catalog_course_id, term_id)
);

comment on table public.catalog_offerings is
  'Which catalog courses are actually offered in which term — self-input verification checks membership here.';

create index catalog_offerings_term_idx on public.catalog_offerings (term_id);

-- Enrollments learn where their course claim came from.
alter table public.enrollments
  add column catalog_course_id uuid references public.catalog_courses(id) on delete set null;

comment on column public.enrollments.catalog_course_id is
  'Set when the enrollment was matched to a catalog row (self-input verified path). Null for Canvas/schedule/free-text enrollments.';

-- RLS: the catalog is reference data — readable by any signed-in student at
-- that university, writable only through the service role (seeding/refresh).
alter table public.catalog_courses enable row level security;
alter table public.catalog_offerings enable row level security;

create policy "students can browse their university's catalog"
  on public.catalog_courses for select
  to authenticated
  using (
    university_id = (
      select p.university_id from public.profiles p where p.id = auth.uid()
    )
  );

create policy "students can see offerings for their catalog"
  on public.catalog_offerings for select
  to authenticated
  using (
    exists (
      select 1
      from public.catalog_courses c
      join public.profiles p on p.university_id = c.university_id
      where c.id = catalog_course_id and p.id = auth.uid()
    )
  );

-- Typeahead search over this term's offerings at the caller's university.
-- "MAT 21A", "mat21a", and "calculus" all hit. Security invoker: the
-- policies above already scope rows to the caller's campus.
create or replace function public.search_catalog(q text)
returns table (
  id uuid,
  code text,
  title text,
  units numeric,
  offered_now boolean
)
language sql stable security invoker set search_path = public
as $$
  with me as (
    select p.university_id from public.profiles p where p.id = auth.uid()
  ),
  current_term as (
    select t.id
    from public.terms t, me
    where t.university_id = me.university_id
      and now()::date between t.starts_on and t.ends_on
    limit 1
  ),
  needle as (
    select regexp_replace(upper(trim(q)), '\s+', '', 'g') as compact,
           '%' || trim(q) || '%' as loose
  )
  select
    c.id,
    c.subject_code || ' ' || c.course_number as code,
    c.title,
    c.units,
    exists (
      select 1 from public.catalog_offerings o, current_term ct
      where o.catalog_course_id = c.id and o.term_id = ct.id
    ) as offered_now
  from public.catalog_courses c, me, needle
  where c.university_id = me.university_id
    and (
      replace(c.subject_code || c.course_number, ' ', '') like needle.compact || '%'
      or c.title ilike needle.loose
    )
  order by offered_now desc, c.subject_code, c.course_number
  limit 20;
$$;

comment on function public.search_catalog(text) is
  'Typeahead over the caller''s university catalog: prefix match on the compacted code (MAT21A) or substring on the title, current-term offerings first.';

revoke execute on function public.search_catalog(text) from public, anon;
grant execute on function public.search_catalog(text) to authenticated;

-- Verified self-input: create-or-find the course row for a catalog course in
-- the current term, enroll the caller, and stamp the enrollment with the
-- catalog id. SECURITY DEFINER because course/channel provisioning crosses
-- RLS (mirrors the Canvas sync path's service work) — guarded to the
-- caller's own university and identity.
create or replace function public.enroll_from_catalog(p_catalog_course_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_university uuid;
  v_term uuid;
  v_cat public.catalog_courses;
  v_course_id uuid;
  v_channel_id uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select p.university_id into v_university
  from public.profiles p where p.id = v_uid;

  select * into v_cat
  from public.catalog_courses c
  where c.id = p_catalog_course_id and c.university_id = v_university;
  if not found then
    raise exception 'course not in your catalog';
  end if;

  select t.id into v_term
  from public.terms t
  where t.university_id = v_university
    and now()::date between t.starts_on and t.ends_on
  limit 1;

  if not exists (
    select 1 from public.catalog_offerings o
    where o.catalog_course_id = v_cat.id and o.term_id = v_term
  ) then
    raise exception 'course is not offered this term';
  end if;

  -- Find or create the course row for this term.
  select c.id into v_course_id
  from public.courses c
  where c.university_id = v_university
    and c.term_id = v_term
    and c.code = v_cat.subject_code || ' ' || v_cat.course_number;

  if v_course_id is null then
    insert into public.courses (university_id, term_id, code, title)
    values (v_university, v_term,
            v_cat.subject_code || ' ' || v_cat.course_number, v_cat.title)
    returning id into v_course_id;
  end if;

  insert into public.enrollments (user_id, course_id, source, catalog_course_id)
  values (v_uid, v_course_id, 'manual', v_cat.id)
  on conflict (user_id, course_id)
    do update set catalog_course_id = excluded.catalog_course_id;

  -- Course channel: find or create, then join (mirrors the manual-pick flow).
  select ch.id into v_channel_id
  from public.channels ch where ch.course_id = v_course_id;

  if v_channel_id is null then
    insert into public.channels (university_id, course_id, kind, name, slug, description, created_by)
    values (
      v_university, v_course_id, 'course',
      v_cat.subject_code || ' ' || v_cat.course_number,
      lower(replace(v_cat.subject_code || '-' || v_cat.course_number, ' ', '')),
      'Course chat for ' || v_cat.subject_code || ' ' || v_cat.course_number,
      v_uid
    )
    returning id into v_channel_id;
  end if;

  insert into public.channel_members (channel_id, user_id)
  values (v_channel_id, v_uid)
  on conflict do nothing;

  return v_course_id;
end;
$$;

comment on function public.enroll_from_catalog(uuid) is
  'Catalog-verified self-input: enrolls the caller in a current-term catalog course, provisioning the course row and chat channel if needed. Definer-guarded to the caller''s own campus.';

revoke execute on function public.enroll_from_catalog(uuid) from public, anon;
grant execute on function public.enroll_from_catalog(uuid) to authenticated;
