-- Hearth tuning: the friendships policies stop re-evaluating auth.uid()
-- per row. The performance linter flagged all four 0050/0052 policies;
-- every other table in the catalog already wraps the call as
-- (select auth.uid()) so the planner runs it once per statement. Same
-- predicates, same behaviour, one InitPlan instead of a per-row call.

drop policy friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

drop policy friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
    and responded_at is null
    and exists (
      select 1 from public.profiles p
      where p.id = addressee_id
        and p.university_id = public.current_university_id()
    )
  );

drop policy friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update to authenticated
  using (addressee_id = (select auth.uid()) and status = 'pending')
  with check (status = 'accepted');

drop policy friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
