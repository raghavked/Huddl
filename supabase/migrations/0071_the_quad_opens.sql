-- The Quad opens: a campus-wide feed with a name on every post.
--
-- Yik Yak's herd is anonymous and its posts evaporate. Hearth's answer
-- runs the other way: THE QUAD is the campus-wide feed every verified
-- student is part of from their first minute, and everything on it wears
-- a real name, a real major, a real face. Nothing on Hearth is
-- anonymous, on purpose: identity is the moderation system that works
-- before the moderators wake up. Around The Quad, the community feeds
-- learn the crafts a campus actually needs and an anonymous app cannot
-- build:
--
--   · pins: stewards keep the week's post where people land
--   · most helpful: the asker crowns the comment that solved it, and
--     the helper gets the credit under their own name
--   · event shares: a post can carry an event, so "who's in" happens
--     where people already are
--   · course tags: a post can wear a course, so study plans find the
--     classmates they concern
--   · rules: a community can write its own ground rules under the
--     campus-wide guidelines
--   · saved posts: bookmarks learn the feed
--
-- This migration also closes a gap 0070 left open: the UPDATE grant on
-- community_posts covered every column, so an author could in principle
-- have rewritten their own score. Grants are now column-scoped and the
-- trigger-maintained columns (score, comment_count, hidden_at) can only
-- move through their definer triggers.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · the quad, one per campus, joined at birth
-- ═══════════════════════════════════════════════════════════════════════

alter table public.communities
  add column is_default boolean not null default false,
  add column rules text check (length(rules) <= 1000);

comment on column public.communities.is_default is
  'The Quad: the campus-wide feed, created with the university and joined '
  'automatically at signup. Undeletable; stewarded by campus moderators.';

-- The Quad cannot be closed, by anyone.
alter policy "stewards can close their community" on public.communities
  using ((is_community_steward(id) or is_moderator()) and not is_default);

insert into public.communities (university_id, name, slug, description, is_default)
select u.id, 'The Quad', 'quad',
       'The campus-wide feed. Everyone here actually goes here.', true
from public.universities u
where not exists (
  select 1 from public.communities c
  where c.university_id = u.id and c.is_default
);

-- Every existing student joins their campus Quad now; every future
-- student joins it the moment their profile is born.
insert into public.community_members (community_id, user_id)
select c.id, p.id
from public.profiles p
join public.communities c on c.university_id = p.university_id and c.is_default
on conflict do nothing;

create or replace function public.join_default_communities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.community_members (community_id, user_id)
  select c.id, new.id
  from public.communities c
  where c.university_id = new.university_id and c.is_default
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.join_default_communities() from public, anon, authenticated;

create trigger on_profile_join_default_communities
  after insert on public.profiles
  for each row execute function public.join_default_communities();

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · the feed learns its craft
-- ═══════════════════════════════════════════════════════════════════════

alter table public.community_posts
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles(id) on delete set null,
  add column best_comment_id uuid references public.post_comments(id) on delete set null,
  add column event_id uuid references public.events(id) on delete set null,
  add column course_id uuid references public.courses(id) on delete set null;

create index community_posts_pinned_idx
  on public.community_posts (community_id) where pinned_at is not null;

-- Close 0070's over-broad grant: writable columns only. The
-- trigger-maintained trio (score, comment_count, hidden_at) moves only
-- through its definer triggers from here on.
revoke update on public.community_posts from authenticated;
grant update (title, body, edited_at, deleted_at, pinned_at, pinned_by,
              best_comment_id, event_id, course_id)
  on public.community_posts to authenticated;

revoke update on public.post_comments from authenticated;
grant update (deleted_at) on public.post_comments to authenticated;

-- Who may move what: authors edit their words, stewards pin, the asker
-- crowns the most helpful comment. RLS says who may touch the row; this
-- says which hands fit which levers.
create or replace function public.feed_levers_fit_their_hands()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.title is distinct from old.title or new.body is distinct from old.body)
     and auth.uid() is distinct from old.author_id then
    raise exception 'Only the author can edit their post.';
  end if;

  if (new.pinned_at is distinct from old.pinned_at
      or new.pinned_by is distinct from old.pinned_by) then
    if not (public.is_community_steward(old.community_id) or public.is_moderator()) then
      raise exception 'Only the steward pins posts.';
    end if;
    if new.pinned_at is not null and new.pinned_by is distinct from auth.uid() then
      new.pinned_by := auth.uid();
    end if;
    if new.pinned_at is null then
      new.pinned_by := null;
    end if;
  end if;

  if new.best_comment_id is distinct from old.best_comment_id then
    if auth.uid() is distinct from old.author_id then
      raise exception 'Only the person who posted can pick the most helpful comment.';
    end if;
    if new.best_comment_id is not null and not exists (
      select 1 from public.post_comments pc
      where pc.id = new.best_comment_id
        and pc.post_id = old.id
        and pc.deleted_at is null
    ) then
      raise exception 'That comment does not belong to this post.';
    end if;
  end if;

  if (new.event_id is distinct from old.event_id
      or new.course_id is distinct from old.course_id)
     and auth.uid() is distinct from old.author_id then
    raise exception 'Only the author can change what their post carries.';
  end if;

  return new;
end;
$$;

revoke execute on function public.feed_levers_fit_their_hands() from public, anon, authenticated;

create trigger feed_levers_fit_their_hands
  before update on public.community_posts
  for each row execute function public.feed_levers_fit_their_hands();

-- Being crowned most helpful is worth hearing about, under your own name.
create or replace function public.thank_the_most_helpful()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment public.post_comments%rowtype;
  v_name text;
begin
  if new.best_comment_id is not null
     and new.best_comment_id is distinct from old.best_comment_id then
    select * into v_comment from public.post_comments where id = new.best_comment_id;
    if v_comment.author_id <> new.author_id
       and not public.is_blocked_either(v_comment.author_id, new.author_id) then
      select display_name into v_name from public.profiles where id = new.author_id;
      insert into public.notifications (user_id, kind, title, body, link)
      values (
        v_comment.author_id, 'thanks',
        coalesce(v_name, 'A classmate') || ' found your comment most helpful',
        left(v_comment.body, 140),
        '/communities/' || new.community_id || '/posts/' || new.id
      );
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.thank_the_most_helpful() from public, anon, authenticated;

create trigger thank_the_most_helpful
  after update on public.community_posts
  for each row execute function public.thank_the_most_helpful();

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · bookmarks learn the feed
-- ═══════════════════════════════════════════════════════════════════════

alter table public.message_bookmarks
  add column community_post_id uuid references public.community_posts(id) on delete cascade;

alter table public.message_bookmarks drop constraint bookmark_has_one_subject;
alter table public.message_bookmarks add constraint bookmark_has_one_subject check (
  (message_id is not null)::int
  + (dm_message_id is not null)::int
  + (community_post_id is not null)::int = 1
);

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · the demo campus Quad says hello
-- ═══════════════════════════════════════════════════════════════════════

insert into public.community_posts (community_id, author_id, title, body)
select c.id, 'd0000000-0000-4000-8000-000000000010',
       'This is The Quad',
       'The campus-wide feed. Every post here wears a real name, and the campus sorts it with the arrows. Communities one tab over run their own feeds just like it.'
from public.communities c
where c.university_id = 'd0000000-0000-4000-8000-000000000001' and c.is_default;
