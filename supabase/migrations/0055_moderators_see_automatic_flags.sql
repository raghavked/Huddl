-- Hearth repair: the queue shows moderators the flags Hearth itself filed.
--
-- Found by the simulated-user fleet: a moderator saw 13 reports and 0 of
-- the 6 automatic slur flags sitting beside them. 0034's moderator policies
-- scope the queue to the moderator's campus through the REPORTER's profile
-- ("exists (profiles p where p.id = reporter_id and p.university_id =
-- current_university_id())"), and an automatic flag has no reporter, so the
-- EXISTS is false and the row is invisible to the very people it was filed
-- to summon. Invisible and untriageable: the update policy carries the same
-- predicate.
--
-- The campus scope is right and stays. An automatic flag just answers the
-- "whose campus?" question through the only person actually on it: the
-- author of the flagged content, who is always recorded in
-- reported_user_id. So each policy gains one arm: a null-reporter row is
-- readable and triageable by a moderator on the reported author's campus.

drop policy "reporters and moderators read reports" on public.reports;
create policy "reporters and moderators read reports" on public.reports
  for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or (
      public.is_moderator()
      and (
        exists (
          select 1 from public.profiles p
          where p.id = reports.reporter_id
            and p.university_id = public.current_university_id()
        )
        or (
          reports.reporter_id is null
          and exists (
            select 1 from public.profiles p
            where p.id = reports.reported_user_id
              and p.university_id = public.current_university_id()
          )
        )
      )
    )
  );

drop policy "moderators triage the queue" on public.reports;
create policy "moderators triage the queue" on public.reports
  for update to authenticated
  using (
    public.is_moderator()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = reports.reporter_id
          and p.university_id = public.current_university_id()
      )
      or (
        reports.reporter_id is null
        and exists (
          select 1 from public.profiles p
          where p.id = reports.reported_user_id
            and p.university_id = public.current_university_id()
        )
      )
    )
  )
  with check (
    public.is_moderator()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = reports.reporter_id
          and p.university_id = public.current_university_id()
      )
      or (
        reports.reporter_id is null
        and exists (
          select 1 from public.profiles p
          where p.id = reports.reported_user_id
            and p.university_id = public.current_university_id()
        )
      )
    )
  );
