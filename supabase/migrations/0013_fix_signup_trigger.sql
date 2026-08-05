-- Huddl fix: the handle_new_user trigger declared a local variable named
-- `email_domain` that collided with universities.email_domain, making the
-- lookup ambiguous (42702) and failing EVERY signup. Rename the locals and
-- qualify the column so the domain match resolves correctly.

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  univ_id uuid;
  v_domain text;
  base_handle text;
  candidate text;
  n int := 0;
begin
  v_domain := split_part(new.email, '@', 2);
  select u.id into univ_id
  from public.universities u
  where u.email_domain = v_domain;
  if univ_id is null then
    raise exception 'Unsupported university email domain: %', v_domain;
  end if;

  base_handle := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '', 'g');
  base_handle := substr(coalesce(nullif(base_handle, ''), 'student'), 1, 20);
  if length(base_handle) < 3 then
    base_handle := base_handle || 'student';
  end if;
  candidate := base_handle;
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := base_handle || n::text;
  end loop;

  insert into public.profiles (id, university_id, handle, display_name)
  values (
    new.id,
    univ_id,
    candidate,
    coalesce(new.raw_user_meta_data->>'display_name', initcap(replace(base_handle, '_', ' ')))
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
