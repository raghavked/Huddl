-- Hearth repair: the words behind an automatic flag are readable in triage.
--
-- Same null-reporter blind spot as 0055, one function over. 0038's
-- `reported_content()` proves the moderator is on the report's campus by
-- looking up the REPORTER's profile, and an automatic flag has none, so
-- opening one raised "not your campus" at every moderator on every campus.
-- The campus answer for a null-reporter row lives in `reported_user_id`
-- (the author of the flagged content, always recorded), so the check asks
-- there instead.

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

  -- A student-filed report belongs to its reporter's campus; an automatic
  -- flag (reporter null) to the flagged author's.
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
