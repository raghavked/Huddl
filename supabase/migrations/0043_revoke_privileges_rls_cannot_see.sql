-- Huddl schema: take away the three privileges row-level security cannot
-- restrain, and the grant that contradicts a table's own comment.
--
-- Every policy in this schema is written on the assumption that RLS is what
-- stands between a student and a row. For SELECT, INSERT, UPDATE and DELETE
-- that assumption is exactly right. For three other privileges it is simply
-- false, and `authenticated` holds all three on all fifty public tables —
-- not because anyone granted them, but because that is what Supabase's
-- default privileges hand out and nothing has ever taken them back:
--
--   TRUNCATE   — not filtered by RLS at all. A role holding it can empty a
--                table completely, policies and all. There is no policy that
--                can say no, because TRUNCATE never consults one.
--   TRIGGER    — lets the holder attach a trigger to the table, which is a
--                way to make somebody else's write run your code.
--   REFERENCES — lets the holder point a foreign key at the table, which
--                leaks the existence of rows through constraint violations.
--
-- None of this is reachable today. PostgREST speaks four verbs and TRUNCATE
-- is not among them, and the other two need DDL, which the API does not
-- offer. This is not a fix for a live hole; it is the removal of a hole that
-- opens the day anything else can speak SQL as `authenticated` — a pooler
-- connection handed to a tool, a future admin surface, a third-party
-- integration given the anon key. On that day the difference between "RLS
-- protects us" and "RLS protects us except for TRUNCATE" is the whole
-- database.
--
-- Nothing legitimate loses anything. The definer functions that write these
-- tables run as the owner and are unaffected; the clients only ever SELECT,
-- INSERT, UPDATE and DELETE through PostgREST, all of which are untouched.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · The three privileges no policy can constrain.
-- ═══════════════════════════════════════════════════════════════════════

revoke truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- And for tables that do not exist yet, so the next migration does not
-- quietly restore what this one removed.
--
-- This binds to the role running it, which for a migration is `postgres` —
-- so every table a future migration creates is covered. The schema also
-- carries a second default ACL owned by `supabase_admin`, which this cannot
-- touch and which still hands out all three; tables created by Supabase
-- itself would arrive with them. Nothing in this product's migration path
-- creates a table that way, but that is why the verification query in
-- docs/OPERATIONS.md re-checks the grants rather than trusting this line.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · A table whose comment and whose grant disagreed.
--
--     `event_reminder_sent` says of itself: "RLS is on with no policies ON
--     PURPOSE — the only writer is the security-definer sweep, and deny-all
--     for everyone else is exactly right." The comment is correct and the
--     empty policy set is correct. But `authenticated` still held INSERT,
--     SELECT, UPDATE and DELETE on it, inert only because the empty policy
--     set denies everything.
--
--     That makes the table safe for exactly as long as nobody adds a policy
--     to it. A single permissive policy written by someone who reads the
--     grant and assumes it means something would open the whole table. Say
--     it in the grant as well as in the policies, so both have to be undone
--     on purpose.
-- ═══════════════════════════════════════════════════════════════════════

revoke all on public.event_reminder_sent from anon, authenticated;

comment on table public.event_reminder_sent is
  'Bookkeeping for the event-reminder cron: one row per reminder already delivered, so a re-run cannot buzz the same person twice. RLS is on with no policies ON PURPOSE — the only writer is the security-definer sweep, and deny-all for everyone else is exactly right. Since 0043 the grants say the same thing: anon and authenticated hold nothing here, so the table stays shut even if someone later adds a policy to it.';
