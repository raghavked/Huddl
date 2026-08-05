-- Huddl schema: security hardening from the tester-panel review.
-- Closes RLS gaps that app-layer checks alone did not enforce.

-- 1) PII: the verified phone number must never be world-readable. It already
--    lives in phone_verifications (owner-only RLS); drop it from the
--    world-readable profiles row. profiles keeps only phone_verified_at (the
--    badge boolean), which is not sensitive.
alter table public.profiles drop column if exists phone;

-- 2) Campus isolation + privacy: scope profile reads to the viewer's own
--    university (or self). Stops cross-campus profile/PII harvesting via the
--    REST API. is_public is still enforced at the app layer for field-level
--    redaction within a campus.
drop policy if exists "profiles are readable by authenticated users" on public.profiles;
create policy "profiles are readable within own university"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or university_id = public.current_university_id());

-- 3) Message edits must not smuggle a row into another channel/thread. Pin
--    membership on the NEW row so channel_id/thread_id can't be repointed
--    past the membership boundary.
drop policy if exists "authors can edit own messages" on public.messages;
create policy "authors can edit own messages"
  on public.messages for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_channel_member(channel_id));

drop policy if exists "authors can edit own dm messages" on public.dm_messages;
create policy "authors can edit own dm messages"
  on public.dm_messages for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_dm_participant(thread_id));

-- 4) Club join must not let a member self-assign 'owner'/'officer'. The
--    founder's owner row is written by the SECURITY DEFINER trigger, so it is
--    unaffected; role changes go through the officer-managed update policy.
drop policy if exists "students can join clubs at their university" on public.club_members;
create policy "students can join clubs at their university"
  on public.club_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'member'
    and public.club_university(club_id) = public.current_university_id()
  );

-- 5) Direct channel joins are only for campus/topic channels. Course and club
--    channel membership is mirrored by triggers from enrollment/roster; a
--    student must not be able to self-insert into a course/club channel.
drop policy if exists "students can join channels at their university" on public.channel_members;
create policy "students can join open channels at their university"
  on public.channel_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.channel_university(channel_id) = public.current_university_id()
    and exists (
      select 1 from public.channels ch
      where ch.id = channel_id and ch.kind in ('campus', 'topic')
    )
  );

-- 6) Enrollment must stay within the student's own university, and students
--    may only enrol themselves as 'student' (TA/instructor is a trusted path).
drop policy if exists "students manage own enrollments" on public.enrollments;
create policy "students manage own enrollments"
  on public.enrollments for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'student'
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.university_id = public.current_university_id()
    )
  );

-- 7) Only club officers may attach an event to a club (the club page shows it
--    as an official "Hosted by <club>" event). Non-club events are unchanged.
drop policy if exists "students can create events at their university" on public.events;
create policy "students can create events at their university"
  on public.events for insert
  to authenticated
  with check (
    creator_id = auth.uid()
    and university_id = public.current_university_id()
    and (club_id is null or public.is_club_officer(club_id))
  );

drop policy if exists "creators can update own events" on public.events;
create policy "creators can update own events"
  on public.events for update
  to authenticated
  using (creator_id = auth.uid())
  with check (
    creator_id = auth.uid()
    and (club_id is null or public.is_club_officer(club_id))
  );

-- 8) Note files must be readable only by enrolled classmates (or the
--    uploader), matching the notes table's RLS — not by any authenticated
--    user who guesses the path.
drop policy if exists "authenticated users can read note files" on storage.objects;
create policy "classmates can read note files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'notes'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.notes n
        where n.storage_path = storage.objects.name
          and public.is_enrolled(n.course_id)
      )
    )
  );
