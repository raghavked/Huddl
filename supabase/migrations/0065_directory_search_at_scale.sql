-- Hearth at scale: the directory learns to paginate and search.
--
-- Both clients have fetched EVERY profile on campus and filtered in
-- memory, which at a thousand students was a 17ms indulgence and at forty
-- thousand is a multi-megabyte payload per open. The clients move to
-- server-side pages and server-side search; these are the indexes that
-- make both cheap:
--
--   · (university_id, display_name) carries the paginated A-to-Z walk.
--   · Trigram indexes on display_name and handle carry contains-search
--     ("mar" finds Maria, Omar, and @marcus) without a sequential scan
--     over the campus.
--   · The studying-now list already has its index: focus_sessions_open_idx
--     from an earlier round is partial on open sessions, which is the only
--     slice of focus_sessions anyone lists, so nothing new is needed there.

create extension if not exists pg_trgm with schema extensions;

create index profiles_campus_name_idx
  on public.profiles (university_id, display_name);

create index profiles_display_name_trgm_idx
  on public.profiles using gin (display_name extensions.gin_trgm_ops);

create index profiles_handle_trgm_idx
  on public.profiles using gin ((handle::text) extensions.gin_trgm_ops);
