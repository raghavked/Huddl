-- Huddl schema: security-advisor sweep after 0018-0021. Trigger functions
-- only ever run as triggers — Postgres refuses direct calls anyway — but
-- they shouldn't sit on the exposed RPC surface at all. (The remaining
-- advisor notes are accepted: citext lives in public since 0002 and the
-- handle column depends on it; the guarded definer RPCs are intentional.)

revoke execute on function public.enforce_message_rate_limit() from public, anon, authenticated;
revoke execute on function public.enforce_dm_rate_limit() from public, anon, authenticated;
revoke execute on function public.enforce_report_rate_limit() from public, anon, authenticated;
revoke execute on function public.notify_course_calendar_item() from public, anon, authenticated;
revoke execute on function public.notify_mentions() from public, anon, authenticated;
revoke execute on function public.push_notification() from public, anon, authenticated;
