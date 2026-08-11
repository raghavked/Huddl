-- Huddl schema: let students shelve their own courses.
--
-- 0028 added enrollments.archived_at but no UPDATE policy, so every archive
-- and unarchive failed the RLS check. Column-scoped grant plus an owner
-- policy: a student may change archived_at on their own enrollment and
-- nothing else — role and source stay out of reach.

revoke update on public.enrollments from authenticated;
grant update (archived_at) on public.enrollments to authenticated;

create policy "students shelve their own enrollments"
  on public.enrollments for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));
