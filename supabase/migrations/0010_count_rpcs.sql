-- Huddl schema: counting RPCs requested during integration.
-- channel_member_counts: RLS on channel_members hides non-joined rosters, so
-- browse/discovery pages can't count members with the session client. This
-- exposes counts (numbers only) for channels at the caller's university.
create or replace function public.channel_member_counts()
returns table (channel_id uuid, member_count bigint)
language sql stable security definer set search_path = public
as $$
  select cm.channel_id, count(*)::bigint
  from public.channel_members cm
  join public.channels ch on ch.id = cm.channel_id
  where ch.university_id = public.current_university_id()
  group by cm.channel_id;
$$;

-- increment_note_download: notes rows are only updatable by their uploader,
-- so classmate downloads can't bump download_count directly. Counts only
-- increment for users allowed to read the note.
create or replace function public.increment_note_download(note uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.notes n
  set download_count = download_count + 1
  where n.id = note
    and public.is_enrolled(n.course_id);
end;
$$;
