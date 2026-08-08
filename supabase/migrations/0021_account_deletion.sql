-- Huddl schema: in-app account deletion — an App Store requirement and a
-- privacy-policy promise. Deleting the auth user cascades through profiles
-- to every table; the student's storage folders are swept in the same call.

create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- Their uploaded files first (uploads live under a folder named by user id).
  delete from storage.objects
  where bucket_id in ('avatars', 'notes', 'schedules', 'chat-uploads')
    and (storage.foldername(name))[1] = v_uid::text;

  -- The auth row cascades to profiles, and profiles cascades to everything
  -- else (messages, enrollments, memberships, notifications, blocks, ...).
  delete from auth.users where id = v_uid;
end;
$$;

comment on function public.delete_own_account() is
  'Deletes the caller''s account and every row and file that hangs off it. Irreversible; the app double-confirms before calling.';

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
