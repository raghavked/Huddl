-- Huddl schema: three fixes found by walking the app as six different
-- students. One is a privacy hole, one is a feature that has never once
-- worked, and one is a promise the export was not keeping.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · The block graph was enumerable by any signed-in student.
--
--     `is_blocked_either(a, b)` is SECURITY DEFINER over `blocks` — a table
--     whose entire design is that the blocked person never finds out. It
--     takes two arbitrary uuids, applies no auth.uid() constraint of its
--     own, and 0019 granted EXECUTE to `authenticated`. Profile ids are
--     handed out freely by the people directory, so anyone could sit at the
--     REST endpoint and ask, pair by pair, who had blocked whom — and, most
--     of all, ask whether one specific person had blocked them.
--
--     The app tells a student four separate times that blocking is
--     invisible: in privacy settings, on the blocked list, on the profile
--     sheet, and in the community guidelines. All four were false against
--     the live API.
--
--     Nothing legitimate needs this grant. Every caller — create_dm_thread,
--     create_group_thread, add_to_group_thread, and the four notify_*
--     triggers — is itself SECURITY DEFINER and therefore executes as the
--     owner, not as the caller. No RLS policy references it, and neither
--     client has ever called it over RPC. Checked all three before writing
--     this line.
-- ═══════════════════════════════════════════════════════════════════════

revoke execute on function public.is_blocked_either(uuid, uuid) from authenticated;

comment on function public.is_blocked_either(uuid, uuid) is
  'True when either student has blocked the other. SECURITY DEFINER over the private blocks table, and deliberately NOT executable by authenticated: it takes two arbitrary ids and would otherwise let anyone enumerate the block graph, which defeats the whole point of a one-way, private block. Call it only from inside other definer functions.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Course colours have never saved, for anyone, since the day they
--     shipped.
--
--     0029 revoked the blanket UPDATE on `enrollments` and granted back a
--     single column, `archived_at`, so a student could shelve a class and
--     change nothing else. 0032 then added `enrollments.color` and never
--     extended the grant. So every colour tap paints optimistically, round
--     trips, is refused, and snaps back with "We couldn't save that colour
--     just now." The feature is in both clients and has never worked once.
-- ═══════════════════════════════════════════════════════════════════════

grant update (archived_at, color) on public.enrollments to authenticated;

comment on column public.enrollments.color is
  'The tint this student picked for the class, carried across the calendar, the plan and the hubs. Column-scoped in the authenticated grant alongside archived_at — role, source and course_id stay out of reach, so a student can recolour their own enrollment and nothing else.';

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · The export said "everything Huddl holds that is yours" and left out
--     the two records the privacy policy specifically says are kept: who
--     the student has blocked, and what they have reported.
--
--     Both tables already scope SELECT to the subject, so this adds no
--     reach — it just stops the document from being quietly incomplete on
--     the two subjects a person requesting an export most likely cares
--     about.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.export_my_data()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'note', 'Everything Huddl holds that is yours. Shared content you wrote stays in the rooms you wrote it in; this is your copy of it.',
    'profile', (select to_jsonb(p) - 'is_moderator' from public.profiles p where p.id = v_uid),
    'courses', (select coalesce(jsonb_agg(jsonb_build_object(
                  'code', c.code, 'title', c.title,
                  'archived_at', e.archived_at, 'color', e.color)), '[]'::jsonb)
                from public.enrollments e
                join public.courses c on c.id = e.course_id
                where e.user_id = v_uid),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object(
                   'channel', ch.name, 'content', m.content,
                   'created_at', m.created_at)), '[]'::jsonb)
                 from public.messages m
                 join public.channels ch on ch.id = m.channel_id
                 where m.author_id = v_uid and m.deleted_at is null),
    'direct_messages', (select coalesce(jsonb_agg(jsonb_build_object(
                          'content', d.content, 'created_at', d.created_at)), '[]'::jsonb)
                        from public.dm_messages d
                        where d.author_id = v_uid and d.deleted_at is null),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object(
                'title', n.title, 'file_name', n.file_name,
                'tags', n.tags, 'created_at', n.created_at)), '[]'::jsonb)
              from public.notes n where n.uploader_id = v_uid),
    'calendar_checkoffs', (select count(*) from public.study_checkoffs where user_id = v_uid),
    'focus_sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                         'started_at', f.started_at, 'ended_at', f.ended_at,
                         'goal_minutes', f.goal_minutes, 'note', f.note)), '[]'::jsonb)
                       from public.focus_sessions f where f.user_id = v_uid),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object(
                 'category', g.name, 'weight', g.weight,
                 'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                               'title', ge.title, 'earned', ge.points_earned,
                               'possible', ge.points_possible)), '[]'::jsonb)
                             from public.grade_entries ge
                             where ge.category_id = g.id))), '[]'::jsonb)
               from public.grade_categories g where g.user_id = v_uid),
    'board_posts', (select coalesce(jsonb_agg(jsonb_build_object(
                      'category', b.category, 'title', b.title,
                      'created_at', b.created_at)), '[]'::jsonb)
                    from public.board_posts b where b.author_id = v_uid),
    'events_created', (select coalesce(jsonb_agg(jsonb_build_object(
                         'title', ev.title, 'starts_at', ev.starts_at)), '[]'::jsonb)
                       from public.events ev where ev.creator_id = v_uid),
    -- Who you have blocked. Handles only, never display names: this is your
    -- record of a decision you made, not a dossier on the other person. The
    -- reverse direction — who has blocked YOU — is deliberately absent, and
    -- must stay absent, or the export becomes the block-graph leak that
    -- section 1 of this migration just closed.
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object(
                  'handle', p.handle, 'blocked_at', bl.created_at)), '[]'::jsonb)
                from public.blocks bl
                join public.profiles p on p.id = bl.blocked_id
                where bl.blocker_id = v_uid),
    -- What you have reported, and what came of it. Only reports you filed;
    -- reports ABOUT you are a moderation record, not your data, and naming
    -- them here would tell someone exactly what they got away with.
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object(
                        'reason', r.reason, 'status', r.status,
                        'created_at', r.created_at)), '[]'::jsonb)
                      from public.reports r where r.reporter_id = v_uid)
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.export_my_data() is
  'The caller''s own data as one JSON document — the counterpart to delete_own_account. Self-only by construction: every subquery filters on auth.uid(). Includes who you blocked and what you reported; deliberately excludes who blocked you and who reported you, both of which belong to someone else.';

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
