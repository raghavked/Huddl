-- Flood control for the feed, before the flood.
--
-- Messages and reports have carried gentle rate limits since their early
-- rounds; the feed shipped without any, which the stress round was about
-- to prove the hard way. One person can be enthusiastic; a script is a
-- flood. The caps are set where no honest student ever meets them:
--
--   posts     5 per 10 minutes per author
--   comments  20 per 10 minutes per author
--   votes     120 new votes per 10 minutes per voter
--
-- Also in this round: the indexes the limits count against, the index
-- that lets a course page show the feed posts wearing its tag, and one
-- overdue copy fix (the reports limit message carried an em dash from
-- before the house banned them).

create index post_votes_voter_idx
  on public.post_votes (user_id, created_at desc);
create index post_comments_author_idx
  on public.post_comments (author_id, created_at desc);
create index community_posts_course_idx
  on public.community_posts (course_id, created_at desc)
  where course_id is not null;

create or replace function public.feed_rate_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  if tg_table_name = 'community_posts' then
    select count(*) into v_recent from public.community_posts
    where author_id = new.author_id and created_at > now() - interval '10 minutes';
    if v_recent >= 5 then
      raise exception 'That is a lot of posts at once. Give the feed a few minutes to breathe.';
    end if;
  elsif tg_table_name = 'post_comments' then
    select count(*) into v_recent from public.post_comments
    where author_id = new.author_id and created_at > now() - interval '10 minutes';
    if v_recent >= 20 then
      raise exception 'That is a lot of comments at once. Give it a few minutes.';
    end if;
  elsif tg_table_name = 'post_votes' then
    select count(*) into v_recent from public.post_votes
    where user_id = new.user_id and created_at > now() - interval '10 minutes';
    if v_recent >= 120 then
      raise exception 'That is a lot of voting at once. Slow down a little.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.feed_rate_limits() from public, anon, authenticated;

create trigger community_posts_rate_limit
  before insert on public.community_posts
  for each row execute function public.feed_rate_limits();
create trigger post_comments_rate_limit
  before insert on public.post_comments
  for each row execute function public.feed_rate_limits();
create trigger post_votes_rate_limit
  before insert on public.post_votes
  for each row execute function public.feed_rate_limits();

-- The reports limit learns the house style: no em dashes anywhere,
-- including the words the database says.
create or replace function public.enforce_report_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.reports
  where reporter_id = new.reporter_id
    and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'You''ve filed a lot of reports this hour. We''re on it. Try again later.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_report_rate_limit() from public, anon, authenticated;
