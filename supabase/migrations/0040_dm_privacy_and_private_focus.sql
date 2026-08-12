-- Huddl schema: two privacy controls a student can actually reach. Who is
-- allowed to open a direct message with you, and whether sitting down to
-- work puts your name on the campus list. Both default to exactly what
-- Huddl does today, so the deploy changes nothing anyone sees until they
-- go and change it themselves.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · profiles.dm_privacy — who may START a new direct message with you.
--
--     Right now anybody who can see your profile can open a thread with
--     you, and the only way to stop it after the fact is to block, which
--     is a heavy, permanent-feeling thing to do to somebody who has merely
--     been persistent. There has been no middle setting between "anyone"
--     and "you are dead to me", and the people who most need one are the
--     people least likely to reach for a block.
--
--     Three values, widest first:
--
--       'campus'     — anyone who can find you, which the rest of the
--                      schema has already narrowed to your university.
--                      This is what the app does today, so it is the
--                      default and no existing student's reach changes on
--                      deploy.
--       'classmates' — only people who share a course with you.
--       'nobody'     — nobody new.
--
--     'campus' asserts no campus test of its own, and that is deliberate.
--     0028's create_dm_thread checked self, profile existence and blocks —
--     it never looked at universities — so a same-campus condition here
--     would not be a privacy default, it would be a brand-new product rule
--     wearing one, refusing a cross-campus DM that worked yesterday. Worse,
--     it would be refused in the recipient's name, blaming a setting they
--     never touched for a boundary they never drew. In practice the value
--     still means what it says: profiles are only readable within your own
--     university (0002), so the people who can reach the Message button
--     are your campus. If Huddl ever wants a hard campus fence on DMs it
--     belongs where 0028 put the group one — an explicit check with its
--     own words — and not smuggled in as the side effect of a default
--     nobody chose.
--
--     The rule binds ONLY on starting a thread. It is not a mute and it
--     is not retroactive: a conversation that already exists keeps working
--     whatever the setting says. Turning this to 'nobody' must not
--     silently strand the threads a student is already in the middle of,
--     and it must not stop them replying to anyone. Reply is governed by
--     is_dm_participant on dm_messages, which this migration does not
--     touch at all.
--
--     Two consequences of putting the check after find-or-create, both
--     deliberate. Someone who has already DM'd you can always DM you
--     again, because that thread exists and gets handed back before the
--     setting is ever consulted. And you can always reopen a thread you
--     started, for the same reason.
--
--     Enforcement lives in the three RPCs that can put two people in a
--     thread together — create_dm_thread, create_group_thread and
--     add_to_group_thread — because between them they are the only way a
--     thread can come into existence: dm_threads and dm_participants have
--     SELECT and UPDATE policies (0005, 0028) and no INSERT policy
--     whatsoever, so a direct insert from `authenticated` fails the RLS
--     check no matter what the client sends. This is a database rule, not
--     a client courtesy.
--
--     Blocking still wins. The block check stays exactly where 0019 put
--     it — first, before the thread lookup — so a block continues to
--     refuse even an existing thread, which is stricter than any value of
--     dm_privacy. dm_privacy is checked afterwards and only in the branch
--     that is about to create something new.
--
--     Group threads are in scope, and an earlier draft of this migration
--     was wrong to leave them out. The argument for leaving them out was
--     that a study group is not a direct message — but it is the same
--     dm_threads row, the same dm_participants row, the same dm_messages
--     table and the same 'dm' notification out of notify_dm_message
--     (0028). Nothing about it is a different feature from the recipient's
--     side; it arrives in the same inbox and buzzes the same phone. Leave
--     the group RPCs unchecked and the setting is decorative: anyone
--     refused a 1:1 with a student on 'nobody' can name that student plus
--     any one other profile, call create_group_thread, and be sitting in
--     front of them a second later. A privacy control with a two-line
--     workaround is not a privacy control.
--
--     So both group RPCs get the same test, in the same place as the block
--     test they already run per member. What that changes, honestly:
--     nothing at all for the default, because 'campus' allows everyone the
--     surrounding campus check already allowed. For a student who has gone
--     and narrowed the setting themselves it does change something, and it
--     is the thing they asked for — on 'classmates' a club officer who
--     shares no course with you can no longer add you to the club chat.
--     That is the setting doing exactly what its own wording promises, to
--     the one person who chose it.
--
--     The asymmetry with 1:1 is intentional and worth stating. There is no
--     find-or-create in the group path, so there is no "existing thread"
--     escape hatch: create_group_thread always creates, and
--     add_to_group_thread always brings in somebody who was not there
--     before. Both are the act of starting a conversation with the person,
--     which is precisely what the setting governs. Nobody is ever removed
--     from a group they are already in, and nobody's existing group goes
--     quiet — leave_group_thread and dm_messages are untouched.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column dm_privacy text not null default 'campus'
    check (dm_privacy in ('campus', 'classmates', 'nobody'));

comment on column public.profiles.dm_privacy is
  'Who may start a NEW conversation with this student — 1:1 or group, since both land in the same inbox and fire the same ''dm'' notification: ''campus'' (anyone who can find them, which 0002 already limits to their university — the default, and what Huddl has always done, so the deploy changes nobody''s experience), ''classmates'' (only people sharing a course), or ''nobody''. Enforced in create_dm_thread, create_group_thread and add_to_group_thread, never on reply: existing threads keep working at every setting, nobody is ever removed from a group, and anyone who has already DM''d you can DM you again. A block is stricter and is checked first. Readable by campus-mates like the rest of the profile, which is what lets a client grey out a Message button honestly.';

-- The classmates test, in one place. SECURITY DEFINER because the caller
-- cannot read the recipient's enrollments: the enrollments SELECT policy
-- (0003) shows you your own rows plus the rows of courses you are in, and
-- deciding "do we share a course" needs to be answerable even when the
-- answer is no.
--
-- Archived enrollments count. Somebody you took a class with last term is
-- still somebody you took a class with, and the alternative is that a
-- student's reachable set quietly shrinks every time a term rolls over —
-- a privacy setting should change when its owner changes it and at no
-- other moment.
--
-- Not granted to `authenticated`, for the reason 0037 gave when it pulled
-- the same grant off is_blocked_either: this takes two arbitrary ids and
-- applies no auth.uid() constraint of its own, so an execute grant would
-- let anyone sit at the REST endpoint and map who shares classes with
-- whom, pair by pair. Its only callers are create_dm_thread,
-- create_group_thread and add_to_group_thread, all three of which are
-- themselves SECURITY DEFINER and so run as the owner.
--
-- 'campus' is a plain true. See the header: this function answers "does
-- the recipient's setting permit this", and the recipient never set a
-- campus boundary — the surrounding code owns that question. Both group
-- RPCs run their own explicit same-campus check (0028) immediately before
-- calling this, so nothing here loosens them.
create or replace function public.dm_privacy_allows(p_sender uuid, p_recipient uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case (select pr.dm_privacy from public.profiles pr where pr.id = p_recipient)
    when 'campus' then true
    when 'classmates' then exists (
      select 1
      from public.enrollments mine
      join public.enrollments theirs on theirs.course_id = mine.course_id
      where mine.user_id = p_sender and theirs.user_id = p_recipient
    )
    when 'nobody' then false
    else false
  end;
$$;

comment on function public.dm_privacy_allows(uuid, uuid) is
  'May p_sender start a NEW conversation with p_recipient — 1:1 or group, they are the same inbox — under p_recipient''s dm_privacy setting? Says nothing about blocks (the caller checks those first, because a block outranks any setting), nothing about campus (the caller owns that too: ''campus'' here is a plain true, because no student ever chose a campus boundary and refusing one in their name would be a lie), and nothing about existing threads, which are always allowed. Unknown or missing settings return false so that a value added later without revisiting this function fails closed and loudly rather than quietly opening everyone''s inbox. Deliberately NOT executable by authenticated: it answers for arbitrary pairs and would otherwise expose who shares classes with whom.';

revoke execute on function public.dm_privacy_allows(uuid, uuid) from public, anon, authenticated;

-- Unchanged from 0028 except for the two guards noted inline: the
-- not-signed-in check (which every RPC written since 0028 carries) and the
-- dm_privacy test, which sits inside the create branch so that finding an
-- existing thread never consults it.
create or replace function public.create_dm_thread(other_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  thread uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if other_user = v_uid then
    raise exception 'Cannot start a DM with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'No such user';
  end if;
  -- Blocks first, and ahead of the lookup, so a block refuses even a
  -- thread that already exists. Unchanged from 0019.
  if public.is_blocked_either(v_uid, other_user) then
    raise exception 'You can''t message this person';
  end if;

  -- Find-or-create, 1:1 only — never a group that happens to hold both
  -- people (0028).
  select p1.thread_id into thread
  from public.dm_participants p1
  join public.dm_participants p2 on p1.thread_id = p2.thread_id
  join public.dm_threads t on t.id = p1.thread_id
  where p1.user_id = v_uid and p2.user_id = other_user
    and not t.is_group;

  if thread is null then
    -- Only here. An existing conversation is never re-litigated against
    -- the other person's current setting, which is what keeps a change to
    -- 'nobody' from breaking threads people are already in.
    if not public.dm_privacy_allows(v_uid, other_user) then
      raise exception 'This person isn''t taking new messages';
    end if;

    insert into public.dm_threads default values returning id into thread;
    insert into public.dm_participants (thread_id, user_id)
    values (thread, v_uid), (thread, other_user);
  end if;
  return thread;
end;
$$;

comment on function public.create_dm_thread(uuid) is
  'Find-or-create the 1:1 thread between the caller and other_user. Refuses across a block in either direction, and refuses to open a NEW thread against the recipient''s dm_privacy setting — but hands back an existing thread unconditionally, so nobody''s current conversations break when they or the other person changes the setting. Groups are never returned; use create_group_thread.';

revoke execute on function public.create_dm_thread(uuid) from public, anon;
grant execute on function public.create_dm_thread(uuid) to authenticated;

-- Both group RPCs, byte-for-byte from 0028 apart from one added check
-- each, placed immediately after the block check that is already there.
-- The order matters and mirrors 1:1: campus first (a stranger from another
-- university is refused for being a stranger, in those words), then the
-- block, then the setting — widest and least personal refusal first, so
-- the message a caller gets is the true reason and not merely the first
-- one that happened to fire.
--
-- The wording stays as vague as its neighbours on purpose. 'someone in
-- that list' does not say who, the same way 0028's block message does not,
-- because on 'classmates' a precise refusal would tell the caller which
-- named person shares no course with them — a fact the enrollments SELECT
-- policy (0003) deliberately will not answer.
create or replace function public.create_group_thread(p_title text, p_user_ids uuid[])
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_university uuid;
  v_thread uuid;
  v_other uuid;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 2 and 60 then
    raise exception 'group names run 2-60 characters';
  end if;

  -- Dedupe, drop the caller, and count what's actually left.
  select array_agg(distinct u) into p_user_ids
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) u
  where u <> v_uid;

  v_count := coalesce(array_length(p_user_ids, 1), 0);
  if v_count < 2 or v_count > 15 then
    raise exception 'groups hold 3-16 people including you';
  end if;

  select university_id into v_university from public.profiles where id = v_uid;

  foreach v_other in array p_user_ids loop
    if not exists (
      select 1 from public.profiles p
      where p.id = v_other and p.university_id = v_university
    ) then
      raise exception 'everyone in a group has to be on your campus';
    end if;
    if public.is_blocked_either(v_uid, v_other) then
      raise exception 'someone in that list can''t be added';
    end if;
    -- New in 0040. The whole loop runs before a single row is written, so
    -- one unwilling member refuses the group outright rather than leaving
    -- a half-built thread behind.
    if not public.dm_privacy_allows(v_uid, v_other) then
      raise exception 'someone in that list isn''t taking new messages';
    end if;
  end loop;

  insert into public.dm_threads (is_group, title, created_by)
  values (true, trim(p_title), v_uid)
  returning id into v_thread;

  insert into public.dm_participants (thread_id, user_id)
  select v_thread, v_uid
  union all
  select v_thread, u from unnest(p_user_ids) u;

  return v_thread;
end;
$$;

comment on function public.create_group_thread(text, uuid[]) is
  'Starts a named group thread with 2-15 campus classmates plus the caller. Blocked pairs are refused, and so is anyone whose dm_privacy will not take a new conversation from the caller — a group is the same inbox and the same push as a DM, so the same setting governs it (0040). All checks run before the thread is written, so a refusal leaves nothing behind.';

create or replace function public.add_to_group_thread(p_thread_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_university uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_dm_participant(p_thread_id) then
    raise exception 'you''re not in this group';
  end if;
  if not exists (
    select 1 from public.dm_threads t where t.id = p_thread_id and t.is_group
  ) then
    raise exception 'only groups take more people';
  end if;
  if (select count(*) from public.dm_participants where thread_id = p_thread_id) >= 16 then
    raise exception 'this group is full at 16';
  end if;

  select university_id into v_university from public.profiles where id = v_uid;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.university_id = v_university
  ) then
    raise exception 'everyone in a group has to be on your campus';
  end if;
  if public.is_blocked_either(v_uid, p_user_id) then
    raise exception 'that person can''t be added';
  end if;
  -- New in 0040. Tested against the ADDER, not against whoever created the
  -- group: the person doing the adding is the one starting this
  -- conversation, and letting a member with a shared course front for one
  -- without would rebuild the same workaround one hop further out.
  if not public.dm_privacy_allows(v_uid, p_user_id) then
    raise exception 'that person isn''t taking new messages';
  end if;

  insert into public.dm_participants (thread_id, user_id)
  values (p_thread_id, p_user_id)
  on conflict do nothing;
end;
$$;

comment on function public.add_to_group_thread(uuid, uuid) is
  'Adds one campus-mate to a group the caller is already in. Refuses across a block and against the added person''s dm_privacy setting, both judged on the caller — the person doing the adding is the one starting the conversation. Existing members are never re-checked and never removed; this guards the doorway only.';

revoke execute on function public.create_group_thread(text, uuid[]) from public, anon;
grant execute on function public.create_group_thread(text, uuid[]) to authenticated;
revoke execute on function public.add_to_group_thread(uuid, uuid) from public, anon;
grant execute on function public.add_to_group_thread(uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · The profiles column grant, which is where this kind of feature goes
--     to die.
--
--     0034 revoked the blanket UPDATE on profiles and granted back an
--     explicit column list, so that a student could not promote themselves
--     to moderator. Correct — but it means every profile column added
--     since has to be named here or it is silently unwritable: the write
--     round-trips, RLS passes, the column privilege refuses, and the
--     setting appears to save and then does not.
--
--     0039 is the migration that fixed the outstanding case of that bug —
--     profiles.quiet_hours, added by 0035 and never granted — and it
--     re-audited the whole list column by column while it was in there.
--     0039 ships in this same deploy and runs first, so its list, not
--     0034's, is the one this restates. All this section does on top is
--     add dm_privacy. Nothing else about the grant changes and no other
--     column is being rescued here.
--
--     dm_privacy is owner-scoped by the "users can update own profile"
--     policy from 0002, like everything else in the list. The columns
--     0039 deliberately withheld stay withheld, for its reasons: id,
--     university_id, phone_verified_at, is_moderator, created_at. (There
--     is no `phone` column to withhold — 0012 dropped it.)
--
--     Additive, no revoke first, for the reason 0039 gave: a table-level
--     REVOKE would drop every column-level grant with it, so restating
--     the list is both sufficient and the only safe shape.
-- ═══════════════════════════════════════════════════════════════════════

grant update (handle, display_name, avatar_url, bio, major, grad_year,
              is_public, accepted_terms_at, notification_prefs,
              share_read_receipts, share_typing, interests, looking_for,
              quiet_hours, dm_privacy, updated_at)
  on public.profiles to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · focus_sessions.is_private — time a session without joining the list.
--
--     0031 already made CLOSED sessions private to their owner, because a
--     full study history is nobody's business. An OPEN session is still
--     campus-visible, and that is the whole point of "studying now": you
--     are not working alone at 1am.
--
--     But sometimes you want the timer and not the audience — you are
--     behind, you are studying something you would rather not announce, or
--     you simply do not want to be found this afternoon. Today the only
--     way to get that is to not use the feature, which also costs you the
--     streak.
--
--     Default false: every session anyone has ever run stays exactly as
--     visible as it is now, and a session started by a client that has not
--     shipped the toggle yet behaves the way it always has.
--
--     Checked for a column-scoped grant in the shape 0029 and 0034 use on
--     enrollments and profiles: focus_sessions has none — no migration
--     revokes UPDATE or INSERT on it — so the default table privileges
--     already cover the new column and there is nothing to extend. The
--     write path is fenced by the three owner policies from 0030 instead
--     — two of which this migration tightens further down, once the read
--     side is settled.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.focus_sessions
  add column is_private boolean not null default false;

comment on column public.focus_sessions.is_private is
  'When true this session never appears on the campus "studying now" list, open or closed; the owner still sees it and it still counts toward their streak. Defaults to false, which is how every session has behaved until now, so existing rows and older clients are unaffected. Read-side only — this hides the row, it does not change how the session is run.';

-- Same policy as 0031, with the one extra condition. Structure preserved
-- on purpose: the owner branch comes first and stands alone, so a student
-- always sees their own sessions whatever is_private says, and the campus
-- branch still requires the session to be open AND the viewer to be on the
-- same campus. This is the only SELECT policy on the table — 0030 split
-- the old FOR ALL owner policy into insert/update/delete precisely so that
-- reads evaluate exactly one policy — which is why that first disjunct has
-- to stay.
drop policy "campus can see who's studying right now" on public.focus_sessions;

create policy "campus can see who's studying right now"
  on public.focus_sessions for select
  to authenticated
  using (
    user_id = ( SELECT auth.uid() )
    or (
      ended_at is null
      and not is_private
      and exists (
        select 1 from public.profiles p
        where p.id = focus_sessions.user_id
          and p.university_id = public.current_university_id()
      )
    )
  );

-- The other half of the same question. This migration is the one that
-- decides who appears on the "studying now" list, and is_private only
-- settles whether you appear at all — it says nothing about WHERE you
-- appear, and the where was never fenced. 0030 split the old FOR ALL owner
-- policy into insert/update/delete and pinned user_id in all three, which
-- stops you giving a session away but leaves course_id completely free.
-- So a student can start a session against CS101 without being enrolled in
-- it, or start an honest one and repoint it afterwards, and either way
-- they turn up on that course's list — visible to a roster they are not
-- on, in a room they cannot otherwise enter. It is the exact pattern 0039
-- section 3 went through the schema removing: insert legitimately, then
-- repoint.
--
-- Both write policies get the same condition, and it has to be both: a
-- check on insert alone is a lock on a door with the window open. null
-- stays allowed because a session with no course is the ordinary case —
-- "I am working" is not a claim about a roster and does not need one.
-- public.is_enrolled is the same helper 0030 used on study_buddy_optins
-- one screen below, and it already resolves the caller from auth.uid()
-- internally, so nothing here needs its own ( SELECT auth.uid() ) wrap.
--
-- One consequence, accepted with eyes open: is_enrolled is evaluated on
-- every update, not only on updates that move course_id, and RLS cannot
-- see the old row to tell the difference. A student who un-enrols from a
-- course while a session against it is still running can therefore no
-- longer end that session — the ending write fails the same check. That is
-- a genuinely narrow window, it takes a deliberate mid-session un-enrol to
-- reach, and the delete policy from 0030 is unconditional so the stranded
-- row can always be cleared. Paying that for a list that means what it
-- says is the right trade; the alternative shapes all need a trigger to
-- compare old and new, which is a much heavier thing to hang on a table
-- written to every time somebody starts or stops a timer.
drop policy "students start their own sessions" on public.focus_sessions;
drop policy "students end their own sessions" on public.focus_sessions;

create policy "students start their own sessions"
  on public.focus_sessions for insert
  to authenticated
  with check (
    user_id = ( SELECT auth.uid() )
    and (course_id is null or public.is_enrolled(course_id))
  );

-- USING stays exactly as 0030 wrote it — owner only, nothing about the
-- course. Widening the USING would hide rows from their own owner, and a
-- row you cannot see is a row you cannot delete either.
create policy "students end their own sessions"
  on public.focus_sessions for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (
    user_id = ( SELECT auth.uid() )
    and (course_id is null or public.is_enrolled(course_id))
  );

-- No new index. focus_sessions_open_idx (0028) is still the right one for
-- the list — it is already partial on `ended_at is null`, and is_private
-- is true on a small minority of rows, so it is a cheap filter on top of a
-- small index rather than a reason to maintain a second one on a table
-- that is written to every time somebody starts or stops a timer.
