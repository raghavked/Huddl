-- Every campus opens with a Quad.
--
-- 0071 gave the ten existing campuses their Quad as a backfill, which
-- left a trap for the eleventh: the operations playbook opens a campus
-- by inserting a university row, and students would have arrived to a
-- campus with no campus-wide feed and an auto-join trigger pointing at
-- nothing. The stress round's fresh simulated campus walked straight
-- into it. Now the Quad is born with the university.

create or replace function public.open_campus_with_a_quad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.communities (university_id, name, slug, description, is_default)
  values (new.id, 'The Quad', 'quad',
          'The campus-wide feed. Everyone here actually goes here.', true)
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.open_campus_with_a_quad() from public, anon, authenticated;

create trigger on_university_created
  after insert on public.universities
  for each row execute function public.open_campus_with_a_quad();
