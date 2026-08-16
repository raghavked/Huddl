-- Hearth repair: two holes in the auto-flag's memory, found by review.
--
-- ONE. The one-flag-per-subject dedup in 0051 never looked at status. A
-- dismissed flag therefore suppressed every future flag on the same
-- subject forever: a student whose bio flag was dismissed could edit in a
-- different slur next week and the trigger would stay silent. The dedup
-- now only counts OPEN flags; once a moderator settles one, the alarm is
-- re-armed.
--
-- TWO. A flagged club announcement had nowhere to point. `reports` had no
-- club_announcements column, so the flag stored only the author, which
-- (a) made its dedup shape identical to a profile flag (one suppressed
-- the other), and (b) left the moderator staring at a flag with no way to
-- read the words. Reports grow `club_announcement_id`, the trigger sets
-- it, the subject constraint accepts it, and `reported_content()` learns
-- to hand a moderator the announcement text like it does a DM's.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · reports can point at a club announcement
-- ═══════════════════════════════════════════════════════════════════════

alter table public.reports
  add column club_announcement_id uuid
    references public.club_announcements(id) on delete set null;

alter table public.reports drop constraint reports_have_subject;
alter table public.reports add constraint reports_have_subject
  check (
    message_id is not null
    or reported_user_id is not null
    or board_post_id is not null
    or dm_message_id is not null
    or club_announcement_id is not null
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · the trigger: open-only dedup, per-surface shapes
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.autoflag_slurs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text   text;
  v_author uuid;
  v_term   text;
begin
  if tg_table_name = 'messages' or tg_table_name = 'dm_messages' then
    if new.deleted_at is not null then
      return new;
    end if;
    v_text   := new.content;
    v_author := new.author_id;
  elsif tg_table_name = 'board_posts' then
    v_text   := new.title || ' ' || coalesce(new.body, '');
    v_author := new.author_id;
  elsif tg_table_name = 'club_announcements' then
    v_text   := new.title || ' ' || coalesce(new.body, '');
    v_author := new.author_id;
  elsif tg_table_name = 'profiles' then
    v_text   := coalesce(new.display_name, '') || ' '
             || coalesce(new.bio, '') || ' '
             || coalesce(new.looking_for, '');
    v_author := new.id;
  else
    return new;
  end if;

  v_term := public.find_slur(v_text);
  if v_term is null then
    return new;
  end if;

  -- One OPEN automatic flag per subject: a settled flag re-arms the alarm
  -- for the next edit, and every surface deduplicates only against itself.
  if exists (
    select 1 from public.reports r
    where r.reporter_id is null
      and r.status = 'open'
      and case tg_table_name
            when 'messages'           then r.message_id           = new.id
            when 'dm_messages'        then r.dm_message_id        = new.id
            when 'board_posts'        then r.board_post_id        = new.id
            when 'club_announcements' then r.club_announcement_id = new.id
            else r.reported_user_id = v_author
                 and r.message_id is null
                 and r.dm_message_id is null
                 and r.board_post_id is null
                 and r.club_announcement_id is null
          end
  ) then
    return new;
  end if;

  insert into public.reports
    (reporter_id, category, reason, status,
     message_id, dm_message_id, board_post_id, club_announcement_id,
     reported_user_id)
  values
    (null, 'hate',
     'Flagged automatically: this contains the slur "' || v_term || '". '
       || 'Swearing alone never trips this filter; slurs always do.',
     'open',
     case when tg_table_name = 'messages'           then new.id end,
     case when tg_table_name = 'dm_messages'        then new.id end,
     case when tg_table_name = 'board_posts'        then new.id end,
     case when tg_table_name = 'club_announcements' then new.id end,
     v_author);

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · triage can read a flagged announcement
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.reported_content(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_report public.reports;
  v_campus_anchor uuid;
  v_content text;
  v_author uuid;
  v_at timestamptz;
  v_deleted timestamptz;
  v_kind text;
begin
  if not public.is_moderator() then
    raise exception 'not a moderator';
  end if;

  select * into v_report from public.reports r where r.id = p_report_id;
  if not found then
    return null;
  end if;

  v_campus_anchor := coalesce(v_report.reporter_id, v_report.reported_user_id);
  if not exists (
    select 1 from public.profiles p
    where p.id = v_campus_anchor
      and p.university_id = public.current_university_id()
  ) then
    raise exception 'not your campus';
  end if;

  if v_report.message_id is not null then
    select m.content, m.author_id, m.created_at, m.deleted_at, 'channel'
      into v_content, v_author, v_at, v_deleted, v_kind
    from public.messages m where m.id = v_report.message_id;
  elsif v_report.dm_message_id is not null then
    select d.content, d.author_id, d.created_at, d.deleted_at, 'direct'
      into v_content, v_author, v_at, v_deleted, v_kind
    from public.dm_messages d where d.id = v_report.dm_message_id;
  elsif v_report.club_announcement_id is not null then
    select a.title || E'\n' || coalesce(a.body, ''), a.author_id, a.created_at,
           null::timestamptz, 'announcement'
      into v_content, v_author, v_at, v_deleted, v_kind
    from public.club_announcements a
    where a.id = v_report.club_announcement_id;
  else
    return null;
  end if;

  if v_content is null then
    return null;
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'content', v_content,
    'author_id', v_author,
    'created_at', v_at,
    'deleted_at', v_deleted
  );
end;
$$;
