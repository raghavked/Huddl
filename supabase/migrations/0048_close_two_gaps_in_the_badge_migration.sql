-- ═══════════════════════════════════════════════════════════════════════
-- Two things migration 0047 got wrong, found by the database linter.
--
-- 0047 added four functions for the verified badge and was careful with
-- three of them. This closes the two it was not careful with. Neither is
-- exploitable on its own, and both are the kind of omission that only ever
-- gets found by a tool, which is the argument for running the tool.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- 1 · sync_verified_on_confirm() was callable over the REST API.
--
--     It is an AFTER UPDATE trigger on auth.users, and 0047 revoked EXECUTE
--     on both of its siblings (email_is_confirmed, sync_profile_verified)
--     and simply missed this one. PostgREST exposes every executable
--     function in `public`, so it sat at /rest/v1/rpc/sync_verified_on_confirm
--     for anon and authenticated alike, as SECURITY DEFINER.
--
--     Calling it directly raises rather than doing damage: the body reads
--     NEW, which is null outside a trigger, so it takes its own exception
--     branch and returns. That is an accident of how it is written, not a
--     defence. A trigger function is not an API and should not be reachable
--     as one.
-- ───────────────────────────────────────────────────────────────────────

revoke execute on function public.sync_verified_on_confirm()
  from public, anon, authenticated;

comment on function public.sync_verified_on_confirm() is
  'AFTER UPDATE on auth.users: re-stamps profiles.verified_at when an account confirms its email. A trigger, never an API. EXECUTE is revoked from anon and authenticated (0048) so PostgREST does not expose it; the trigger itself runs as the definer and is unaffected.';

-- ───────────────────────────────────────────────────────────────────────
-- 2 · profile_is_complete() had a mutable search_path.
--
--     The other three functions 0047 added all pin it. This one did not,
--     and it is the function that decides whether a badge is earned.
--
--     The realistic blast radius is small: its only caller is
--     sync_profile_verified, which is SECURITY DEFINER with its own pinned
--     path, so the trigger route was never at risk. But the function is
--     also callable over REST, where the caller controls search_path, and
--     a function that answers "is this student verified" should not depend
--     on who is asking.
--
--     Pinned to the empty string rather than to `public`. The body touches
--     no schema-qualified object at all: the parameter type is resolved at
--     creation time, the fields are read off the row, and btrim, lower and
--     coalesce live in pg_catalog, which is always searched. Empty is the
--     strongest setting that still works.
--
--     The body below is byte-identical to 0047's. Only the SET changed.
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.profile_is_complete(p public.profiles)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(btrim(p.display_name), '') <> ''
    and lower(btrim(p.display_name)) <> lower(btrim(p.handle::text))
    and coalesce(btrim(p.avatar_url), '') <> ''
    and coalesce(btrim(p.major), '') <> ''
    and p.grad_year is not null;
$$;

comment on function public.profile_is_complete(public.profiles) is
  'The profile half of the verified badge: a real display name that is not just the handle, a photo, a major, and a graduation year. Deliberately excludes bio, interests and looking_for, which are worth writing but are nobody''s idea of identity. search_path is pinned empty (0048).';
