-- Huddl schema: courses are fully user-managed. The catalog is a typeahead
-- convenience (real UC Davis data for autocomplete), never a gate — students
-- add, rename, and drop their own classes and we take their word for it.
-- This replaces 0016's enroll_from_catalog, dropping the offered-this-term
-- requirement and making the term optional.

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

  -- Best-effort term association; enrolling works with or without one.
  select t.id into v_term
  from public.terms t
  where t.university_id = v_university
    and now()::date between t.starts_on and t.ends_on
  limit 1;

  select c.id into v_course_id
  from public.courses c
  where c.university_id = v_university
    and (c.term_id = v_term or (c.term_id is null and v_term is null))
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
  'Catalog-assisted self-input: enrolls the caller in a catalog course (any term — the catalog suggests, it never gates), provisioning the course row and chat channel if needed.';
