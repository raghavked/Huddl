-- Hearth at scale: the profiles read policy loses its redundant arm.
--
-- The policy said `id = auth.uid() OR university_id = current_university_id()`,
-- and that OR was the last thing standing between the directory and the
-- ordered (university_id, display_name) walk from 0065: Postgres cannot
-- stream an index in display_name order while an OR might admit a row from
-- outside the index condition, so every directory page and search fell back
-- to bitmap-and-sort over the whole campus. 94ms per search at 40,000
-- students, versus 9ms for the walk.
--
-- The arm is provably redundant. current_university_id() is a definer
-- lookup of the caller's OWN profiles row, so:
--   · a student with a profile always satisfies the campus arm for their
--     own row, which is the only row the self arm could ever add;
--   · a caller with no profiles row gets null from the function, and the
--     self arm also matches nothing, because there is no row with their id.
-- Same visible set for every possible caller, one arm fewer, and the
-- planner gets its ordered walk back.

alter policy "profiles are readable within own university" on public.profiles
  using (university_id = (select current_university_id()));
