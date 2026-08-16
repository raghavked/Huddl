-- Hearth hardening: the new functions follow the old rules.
--
-- The security linter, run after 0050-0056 landed, pointed at the two
-- habits this round forgot that every earlier migration kept:
--
--   1. `moderation_normalize` had no pinned search_path. It touches no
--      tables, but a definer caller (`find_slur`) resolves it, so it pins
--      an empty path like every other function in the catalog.
--   2. The six new trigger functions carried the default EXECUTE grant.
--      PostgREST cannot actually run a returns-trigger function, but the
--      older trigger functions all have the grant revoked anyway (belt and
--      braces, 0043's shape), and these should match.

alter function public.moderation_normalize(text) set search_path = '';

revoke execute on function public.stamp_friend_accept() from public, anon, authenticated;
revoke execute on function public.notify_friend_request() from public, anon, authenticated;
revoke execute on function public.notify_friend_accept() from public, anon, authenticated;
revoke execute on function public.scrub_last_seen() from public, anon, authenticated;
revoke execute on function public.absorb_blocked_friend_request() from public, anon, authenticated;
revoke execute on function public.autoflag_slurs() from public, anon, authenticated;
