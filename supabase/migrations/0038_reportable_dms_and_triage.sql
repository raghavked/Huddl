-- Huddl schema: make the moderation queue able to do its job. A reported
-- direct message could not be attached to a report at all, a moderator read
-- every campus's queue rather than their own, and every report arrived
-- without the words that caused it.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · A direct message can now be the subject of a report.
--
--     `reports.message_id` references `public.messages` only, so a student
--     reporting a DM filed a report against the PERSON with the offending
--     words typed into the free-text box, if they thought to include them,
--     and otherwise nowhere. Direct messages are exactly where harassment
--     happens, and they were the one surface the report flow could not name.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.reports add column dm_message_id uuid
  references public.dm_messages(id) on delete set null;

comment on column public.reports.dm_message_id is
  'The reported direct message, when that is what was reported. Nulls out if the message is hard-deleted, and the report survives it — which is why reported_user_id is written alongside.';

alter table public.reports drop constraint reports_have_subject;
alter table public.reports add constraint reports_have_subject
  check (message_id is not null or reported_user_id is not null
         or board_post_id is not null or dm_message_id is not null);

create index reports_dm_message_idx
  on public.reports (dm_message_id) where dm_message_id is not null;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · A moderator was reading every campus's queue.
--
--     0034 added the two moderator policies with no university predicate.
--     Huddl's whole shape is that a campus is a closed community; a
--     moderator at one university had no business seeing another's reports,
--     and that was never intended — it was an omission.
--
--     `reporter_id` is the anchor: a report belongs to the campus of the
--     person who filed it, which is also the campus of the content, since
--     every surface a report can name is campus-scoped.
-- ═══════════════════════════════════════════════════════════════════════

drop policy "reporters and moderators read reports" on public.reports;

create policy "reporters and moderators read reports"
  on public.reports for select
  to authenticated
  using (
    reporter_id = ( SELECT auth.uid() )
    or (
      public.is_moderator()
      and exists (
        select 1 from public.profiles p
        where p.id = reports.reporter_id
          and p.university_id = public.current_university_id()
      )
    )
  );

drop policy "moderators triage the queue" on public.reports;

create policy "moderators triage the queue"
  on public.reports for update
  to authenticated
  using (
    public.is_moderator()
    and exists (
      select 1 from public.profiles p
      where p.id = reports.reporter_id
        and p.university_id = public.current_university_id()
    )
  )
  with check (
    public.is_moderator()
    and exists (
      select 1 from public.profiles p
      where p.id = reports.reporter_id
        and p.university_id = public.current_university_id()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Triage was blind.
--
--     `messages` is readable only to channel members and `dm_messages` only
--     to participants — correctly. But that means a moderator opening a
--     report about a course chat they are not in, or about any DM at all,
--     saw a row with no content: they were being asked to judge words they
--     could not read.
--
--     This is the narrowest thing that fixes it. Not a policy exemption —
--     a moderator still cannot browse `messages` or `dm_messages` — but one
--     function that returns the text of the ONE message a given report
--     names, and only for a moderator on that report's own campus. It reads
--     exactly what is already on the reporter's screen when they file, and
--     nothing else.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.reported_content(p_report_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_report public.reports;
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

  -- Same campus check the read policy applies, repeated here because a
  -- SECURITY DEFINER function does not inherit it.
  if not exists (
    select 1 from public.profiles p
    where p.id = v_report.reporter_id
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
  else
    return null; -- a person or a board post; both are readable already
  end if;

  if v_content is null then
    return null; -- hard-deleted since; the report stands on its own
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

comment on function public.reported_content(uuid) is
  'The words behind one report, for the moderator triaging it. Deliberately narrow: moderator-only, same-campus-only, one report at a time, and it returns nothing for a subject that is not a message. It does NOT grant any ability to read messages generally — a moderator still cannot browse a room they are not in.';

revoke execute on function public.reported_content(uuid) from public, anon;
grant execute on function public.reported_content(uuid) to authenticated;
