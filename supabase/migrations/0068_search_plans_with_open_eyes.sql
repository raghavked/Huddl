-- Hearth at scale: name search stops guessing and starts looking.
--
-- The 40,000-profile load test left one slow query standing: the directory's
-- contains-search over display_name OR handle. Through PostgREST the campus
-- scope reaches the planner as an opaque parameter, so it estimates an
-- average-sized campus, walks the whole real one, and burns ~90ms of CPU per
-- search. Every other directory shape (the A-to-Z walk, the limited-card
-- lists, the handle search) plans fine and stays on PostgREST.
--
-- This function is the one search that needed better eyes. SECURITY DEFINER,
-- so it enforces the campus scope itself, and the inner query runs through
-- EXECUTE, which plans each call with the actual campus and pattern in hand:
-- a skewed launch campus and a rare search term both get the plan their
-- numbers deserve (ordered index walk with early stop, or trigram bitmap).
--
-- It is also STRICTER than the read policy: private profiles come back
-- masked to handle + avatar (the viewer's own row stays whole), which is
-- exactly the stripping both clients already perform, moved to the server
-- so hidden fields never ride the wire at all. p_public_only drops private
-- rows entirely for surfaces that list them separately.

create or replace function public.search_directory(
  p_query text,
  p_offset int default 0,
  p_public_only boolean default false
)
returns table (
  id uuid,
  handle text,
  display_name text,
  avatar_url text,
  major text,
  grad_year int,
  is_public boolean,
  interests text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uni uuid := public.current_university_id();
  v_pat text;
begin
  if v_uni is null then
    return;
  end if;
  v_pat := '%' || replace(replace(replace(coalesce(p_query, ''),
             '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query execute
    'select p.id,
            p.handle::text,
            case when p.is_public or p.id = $4 then p.display_name end,
            p.avatar_url,
            case when p.is_public or p.id = $4 then p.major end,
            case when p.is_public or p.id = $4 then p.grad_year end,
            p.is_public,
            case when p.is_public or p.id = $4 then p.interests end
     from public.profiles p
     where p.university_id = $1
       and (not $5 or p.is_public or p.id = $4)
       and (p.display_name ilike $2 or p.handle::text ilike $2)
     order by p.display_name asc, p.id asc
     limit 60 offset greatest($3, 0)'
    using v_uni, v_pat, p_offset, auth.uid(), p_public_only;
end;
$$;

grant execute on function public.search_directory(text, int, boolean) to authenticated;
revoke execute on function public.search_directory(text, int, boolean) from anon, public;

-- The advisor sweep for this round also caught winning_syllabus_import
-- still executable by anon (a grant that survived its 0063 rewrite).
-- Signed-out callers have no business asking which syllabus won.
revoke execute on function public.winning_syllabus_import(uuid) from anon, public;
