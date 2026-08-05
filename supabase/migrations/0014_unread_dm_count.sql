-- Huddl schema: unread DM thread count RPC for the shell badge.
-- Counts threads where the calling student has messages from the other person
-- newer than their last_read_at cursor (0005_direct_messages.sql).
--
-- SECURITY INVOKER on purpose: the 0005 policies already give a participant
-- select on their own dm_participants rows (user_id = auth.uid()) and on
-- every dm_messages row in their threads (is_dm_participant), which is
-- exactly the data this count reads — no definer escape hatch needed.

create or replace function public.unread_dm_thread_count()
returns integer
language sql stable security invoker set search_path = public
as $$
  select count(*)::integer
  from public.dm_participants p
  where p.user_id = auth.uid()
    and exists (
      select 1
      from public.dm_messages m
      where m.thread_id = p.thread_id
        and m.created_at > p.last_read_at
        and m.author_id <> auth.uid()
        and m.deleted_at is null
    );
$$;

comment on function public.unread_dm_thread_count() is
  'Number of DM threads holding a non-deleted message authored by someone other than the caller and newer than the caller''s last_read_at. Security invoker: RLS on dm_participants/dm_messages scopes rows to the caller''s own threads.';

-- Signed-in students only — mirrors 0011_function_hardening.sql.
revoke execute on function public.unread_dm_thread_count() from public, anon;
grant execute on function public.unread_dm_thread_count() to authenticated;
