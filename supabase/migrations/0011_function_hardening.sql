-- Huddl schema: function hardening (from supabase security advisors).
-- 1) Pin search_path on the one function that lacked it.
-- 2) Trigger functions must not be callable through the REST RPC API at all.
-- 3) Helper/RPC functions are for signed-in students only — never anon.

alter function public.set_updated_at() set search_path = public;

-- Trigger functions: nothing should ever call these directly.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_enrollment() from public, anon, authenticated;
revoke execute on function public.handle_enrollment_deleted() from public, anon, authenticated;
revoke execute on function public.join_default_campus_channels() from public, anon, authenticated;
revoke execute on function public.notify_schedule_event() from public, anon, authenticated;
revoke execute on function public.notify_dm_message() from public, anon, authenticated;
revoke execute on function public.notify_thread_reply() from public, anon, authenticated;
revoke execute on function public.handle_new_club() from public, anon, authenticated;
revoke execute on function public.handle_club_member_added() from public, anon, authenticated;
revoke execute on function public.handle_club_member_removed() from public, anon, authenticated;

-- Helpers + RPCs: authenticated only (RLS policies execute them as the
-- signed-in role; anon has no business calling any of them).
revoke execute on function public.current_university_id() from public, anon;
revoke execute on function public.is_enrolled(uuid) from public, anon;
revoke execute on function public.is_channel_member(uuid) from public, anon;
revoke execute on function public.channel_university(uuid) from public, anon;
revoke execute on function public.is_dm_participant(uuid) from public, anon;
revoke execute on function public.create_dm_thread(uuid) from public, anon;
revoke execute on function public.has_verified_phone() from public, anon;
revoke execute on function public.club_university(uuid) from public, anon;
revoke execute on function public.is_club_officer(uuid) from public, anon;
revoke execute on function public.channel_member_counts() from public, anon;
revoke execute on function public.increment_note_download(uuid) from public, anon;
