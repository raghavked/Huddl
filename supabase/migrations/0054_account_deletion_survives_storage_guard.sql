-- Hearth repair: account deletion works again.
--
-- Found by the simulated-user fleet: `delete_own_account()` has been raising
-- "Direct deletion from storage tables is not allowed" for every caller.
-- Supabase now installs a statement-level BEFORE DELETE trigger on
-- storage.objects (`storage.protect_delete`) that refuses SQL deletes unless
-- the transaction opts in through the `storage.allow_delete_query` setting.
-- Our function predates the guard, so the moment the platform shipped it,
-- "delete the account for good" (a promise the privacy policy makes and the
-- Account screen offers) started erroring instead of deleting.
--
-- The repair is the sanctioned opt-in: set the flag transaction-locally,
-- delete the caller's own files, and put the flag back. The scope stays
-- exactly what it was: only objects in the four app buckets, only under the
-- folder named by the caller's own user id, and then the auth row whose
-- cascade carries away everything else.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- Their uploaded files first (uploads live under a folder named by user
  -- id). The set_config is transaction-local (is_local => true), so the
  -- guard snaps back the instant this transaction ends, whatever happens.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id in ('avatars', 'notes', 'schedules', 'chat-uploads')
    and (storage.foldername(name))[1] = v_uid::text;
  perform set_config('storage.allow_delete_query', 'false', true);

  -- The auth row cascades to profiles, and profiles cascades to everything
  -- else (messages, enrollments, memberships, notifications, blocks, ...).
  delete from auth.users where id = v_uid;
end;
$$;
