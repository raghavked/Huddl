-- The campus learns to post: communities, feeds, votes, and comments.
--
-- Forty thousand students cannot share one linear chat; the fiftieth
-- message scrolls the first away and the room becomes weather. Clubs
-- answered the organized end of campus life, but "people who like
-- gardening" is not an organization, it is an interest. So this round
-- adds COMMUNITIES: lightweight interest spaces anyone on campus can
-- start and join, whose front room is a FEED rather than a chat. Posts
-- carry votes and comments, the herd sorts itself by Top and New, and a
-- post the campus votes down to -5 folds itself away, the same guardrail
-- Yik Yak published. Real-time talk does not disappear: any community
-- can sprout topic channels beside its feed, and the chat machinery
-- that already scales (broadcast topics, membership joins) carries them.
--
--   communities        the spaces: campus-scoped, anyone founds one,
--                      the founder stewards it
--   community_members  joining is following; stewards manage
--   community_posts    the feed: title, body, score, comment count,
--                      hidden_at when the herd says so
--   post_votes         one vote per person per post, up or down
--   post_comments      flat comments, soft-deleted like messages
--   channels           gain community_id: topic channels can belong
--                      to a community
--   reports            gain community_post_id and post_comment_id, and
--                      the slur autoflag learns both new surfaces

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · communities
-- ═══════════════════════════════════════════════════════════════════════

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null check (length(trim(name)) between 3 and 48),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  description text check (length(description) <= 280),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (university_id, slug)
);

create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'steward')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index community_members_user_idx on public.community_members (user_id);

-- Membership checks live in definer helpers so the policies above and
-- below never recurse into their own tables.
create or replace function public.is_community_member(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = auth.uid()
  );
$$;

create or replace function public.is_community_steward(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = auth.uid() and role = 'steward'
  );
$$;

grant execute on function public.is_community_member(uuid) to authenticated;
grant execute on function public.is_community_steward(uuid) to authenticated;
revoke execute on function public.is_community_member(uuid) from anon, public;
revoke execute on function public.is_community_steward(uuid) from anon, public;

alter table public.communities enable row level security;
grant select, insert, update, delete on public.communities to authenticated;

create policy "communities are visible within own university"
  on public.communities for select to authenticated
  using (university_id = (select current_university_id()));

create policy "students can start communities at their university"
  on public.communities for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and university_id = (select current_university_id())
  );

create policy "stewards tend their community"
  on public.communities for update to authenticated
  using (is_community_steward(id) or is_moderator())
  with check (is_community_steward(id) or is_moderator());

create policy "stewards can close their community"
  on public.communities for delete to authenticated
  using (is_community_steward(id) or is_moderator());


alter table public.community_members enable row level security;
grant select, insert, update, delete on public.community_members to authenticated;

create policy "community rosters are visible within own university"
  on public.community_members for select to authenticated
  using (
    (select c.university_id from public.communities c where c.id = community_id)
    = (select current_university_id())
  );

create policy "students join communities at their university"
  on public.community_members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'member'
    and (select c.university_id from public.communities c where c.id = community_id)
        = (select current_university_id())
  );

create policy "members leave, stewards manage"
  on public.community_members for delete to authenticated
  using (user_id = (select auth.uid()) or is_community_steward(community_id));

create policy "stewards can share the trowel"
  on public.community_members for update to authenticated
  using (is_community_steward(community_id))
  with check (is_community_steward(community_id));

-- The founder stewards what they founded.
create or replace function public.handle_new_community()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.community_members (community_id, user_id, role)
    values (new.id, new.created_by, 'steward')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_new_community() from public, anon, authenticated;

create trigger on_community_created
  after insert on public.communities
  for each row execute function public.handle_new_community();

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · the feed
-- ═══════════════════════════════════════════════════════════════════════

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) between 3 and 120),
  body text check (length(body) <= 4000),
  score int not null default 0,
  comment_count int not null default 0,
  hidden_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index community_posts_new_idx
  on public.community_posts (community_id, created_at desc);
create index community_posts_top_idx
  on public.community_posts (community_id, score desc, created_at desc);
create index community_posts_author_idx on public.community_posts (author_id);

alter table public.community_posts enable row level security;
grant select, insert, update on public.community_posts to authenticated;

-- A folded or deleted post stays readable to its author, the steward,
-- and moderators; the campus sees a clean feed.
create policy "the campus reads the feed"
  on public.community_posts for select to authenticated
  using (
    (select c.university_id from public.communities c where c.id = community_id)
    = (select current_university_id())
    and (
      (hidden_at is null and deleted_at is null)
      or author_id = (select auth.uid())
      or is_community_steward(community_id)
      or is_moderator()
    )
  );

create policy "members post to their communities"
  on public.community_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and is_community_member(community_id)
  );

create policy "authors edit, stewards fold"
  on public.community_posts for update to authenticated
  using (
    author_id = (select auth.uid())
    or is_community_steward(community_id)
    or is_moderator()
  )
  with check (
    author_id = (select auth.uid())
    or is_community_steward(community_id)
    or is_moderator()
  );

create table public.post_votes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_votes enable row level security;
grant select, insert, update, delete on public.post_votes to authenticated;

-- Your vote is yours to see; everyone else reads the score on the post.
create policy "votes are private to the voter"
  on public.post_votes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "campus students vote"
  on public.post_votes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select cm.university_id
         from public.community_posts p
         join public.communities cm on cm.id = p.community_id
         where p.id = post_id)
        = (select current_university_id())
  );

create policy "voters change their minds"
  on public.post_votes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "voters take votes back"
  on public.post_votes for delete to authenticated
  using (user_id = (select auth.uid()));

-- The score lives on the post, moved by delta so concurrent votes never
-- lose each other. At -5 the post folds itself away, and it unfolds if
-- the herd changes its mind: hiding is arithmetic, not a verdict.
create or replace function public.settle_post_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post uuid := coalesce(new.post_id, old.post_id);
  v_delta int := coalesce(new.value, 0) - coalesce(old.value, 0);
begin
  if v_delta <> 0 then
    update public.community_posts
       set score = score + v_delta,
           hidden_at = case
             when score + v_delta <= -5 then coalesce(hidden_at, now())
             else null
           end
     where id = v_post;
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.settle_post_score() from public, anon, authenticated;

create trigger post_votes_settle_score
  after insert or update or delete on public.post_votes
  for each row execute function public.settle_post_score();

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;
grant select, insert, update on public.post_comments to authenticated;

create policy "the campus reads the comments"
  on public.post_comments for select to authenticated
  using (
    (select cm.university_id
     from public.community_posts p
     join public.communities cm on cm.id = p.community_id
     where p.id = post_id)
    = (select current_university_id())
  );

create policy "campus students comment"
  on public.post_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select cm.university_id
         from public.community_posts p
         join public.communities cm on cm.id = p.community_id
         where p.id = post_id)
        = (select current_university_id())
  );

create policy "authors and stewards tidy comments"
  on public.post_comments for update to authenticated
  using (
    author_id = (select auth.uid())
    or is_community_steward((select p.community_id from public.community_posts p where p.id = post_id))
    or is_moderator()
  )
  with check (
    author_id = (select auth.uid())
    or is_community_steward((select p.community_id from public.community_posts p where p.id = post_id))
    or is_moderator()
  );

-- Comment count rides the post; the author hears about new comments.
create or replace function public.settle_post_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.community_posts%rowtype;
  v_name text;
begin
  if tg_op = 'INSERT' then
    update public.community_posts
       set comment_count = comment_count + 1
     where id = new.post_id;

    select * into v_post from public.community_posts where id = new.post_id;
    if v_post.author_id <> new.author_id
       and not public.is_blocked_either(v_post.author_id, new.author_id) then
      select display_name into v_name from public.profiles where id = new.author_id;
      insert into public.notifications (user_id, kind, title, body, link)
      values (
        v_post.author_id, 'post_comment',
        coalesce(v_name, 'A classmate') || ' commented on ' || v_post.title,
        left(new.body, 140),
        '/communities/' || v_post.community_id || '/posts/' || new.post_id
      );
    end if;
  elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then
    update public.community_posts
       set comment_count = greatest(comment_count - 1, 0)
     where id = new.post_id;
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.settle_post_comments() from public, anon, authenticated;

create trigger post_comments_settle
  after insert or update on public.post_comments
  for each row execute function public.settle_post_comments();

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array[
    'dm', 'thread_reply', 'schedule_privacy', 'event', 'channel', 'system',
    'course_calendar', 'mention', 'thanks', 'club_post', 'friend',
    'club_invite', 'post_comment'
  ]));

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · channels stem off communities
-- ═══════════════════════════════════════════════════════════════════════

alter table public.channels
  add column community_id uuid references public.communities(id) on delete set null;

create index channels_community_idx
  on public.channels (community_id) where community_id is not null;

comment on column public.channels.community_id is
  'A topic channel can belong to a community: it shows beside the feed '
  'and is created by community members. Null for every other channel.';

-- Topic channels stay student-creatable; claiming one for a community
-- additionally requires being in that community.
alter policy "students can create topic channels at their university" on public.channels
  with check (
    kind = 'topic'
    and university_id = (select current_university_id())
    and created_by = (select auth.uid())
    and (community_id is null or is_community_member(community_id))
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · reporting and the autoflag learn the feed
-- ═══════════════════════════════════════════════════════════════════════

alter table public.reports
  add column community_post_id uuid references public.community_posts(id) on delete set null,
  add column post_comment_id uuid references public.post_comments(id) on delete set null;

alter table public.reports drop constraint reports_have_subject;
alter table public.reports add constraint reports_have_subject check (
  message_id is not null or reported_user_id is not null
  or board_post_id is not null or dm_message_id is not null
  or club_announcement_id is not null
  or community_post_id is not null or post_comment_id is not null
);

create or replace function public.autoflag_slurs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text   text;
  v_author uuid;
  v_term   text;
begin
  if tg_table_name = 'messages' or tg_table_name = 'dm_messages' then
    if new.deleted_at is not null then
      return new;
    end if;
    v_text   := new.content;
    v_author := new.author_id;
  elsif tg_table_name = 'board_posts' then
    v_text   := new.title || ' ' || coalesce(new.body, '');
    v_author := new.author_id;
  elsif tg_table_name = 'club_announcements' then
    v_text   := new.title || ' ' || coalesce(new.body, '');
    v_author := new.author_id;
  elsif tg_table_name = 'community_posts' then
    if new.deleted_at is not null then
      return new;
    end if;
    v_text   := new.title || ' ' || coalesce(new.body, '');
    v_author := new.author_id;
  elsif tg_table_name = 'post_comments' then
    if new.deleted_at is not null then
      return new;
    end if;
    v_text   := new.body;
    v_author := new.author_id;
  elsif tg_table_name = 'profiles' then
    v_text   := coalesce(new.display_name, '') || ' '
             || coalesce(new.bio, '') || ' '
             || coalesce(new.looking_for, '');
    v_author := new.id;
  else
    return new;
  end if;

  v_term := public.find_slur(v_text);
  if v_term is null then
    return new;
  end if;

  if exists (
    select 1 from public.reports r
    where r.reporter_id is null
      and r.status = 'open'
      and case tg_table_name
            when 'messages'           then r.message_id           = new.id
            when 'dm_messages'        then r.dm_message_id        = new.id
            when 'board_posts'        then r.board_post_id        = new.id
            when 'club_announcements' then r.club_announcement_id = new.id
            when 'community_posts'    then r.community_post_id    = new.id
            when 'post_comments'      then r.post_comment_id      = new.id
            else r.reported_user_id = v_author
                 and r.message_id is null
                 and r.dm_message_id is null
                 and r.board_post_id is null
                 and r.club_announcement_id is null
                 and r.community_post_id is null
                 and r.post_comment_id is null
          end
  ) then
    return new;
  end if;

  insert into public.reports
    (reporter_id, category, reason, status,
     message_id, dm_message_id, board_post_id, club_announcement_id,
     community_post_id, post_comment_id,
     reported_user_id)
  values
    (null, 'hate',
     'Flagged automatically: this contains the slur "' || v_term || '". '
       || 'Swearing alone never trips this filter; slurs always do.',
     'open',
     case when tg_table_name = 'messages'           then new.id end,
     case when tg_table_name = 'dm_messages'        then new.id end,
     case when tg_table_name = 'board_posts'        then new.id end,
     case when tg_table_name = 'club_announcements' then new.id end,
     case when tg_table_name = 'community_posts'    then new.id end,
     case when tg_table_name = 'post_comments'      then new.id end,
     v_author);

  return new;
end;
$$;

create trigger community_posts_autoflag_slurs
  after insert or update on public.community_posts
  for each row execute function public.autoflag_slurs();

create trigger post_comments_autoflag_slurs
  after insert or update on public.post_comments
  for each row execute function public.autoflag_slurs();

-- ═══════════════════════════════════════════════════════════════════════
-- 5 · the App Review campus gets one living community
-- ═══════════════════════════════════════════════════════════════════════

-- The demo campus is the one sanctioned demo space. One community, two
-- posts, one comment: enough for a reviewer to see the feed breathe.
insert into public.communities (id, university_id, name, slug, description, created_by)
values (
  'd0000000-0000-4000-8000-00000000c0de',
  'd0000000-0000-4000-8000-000000000001',
  'Campus life', 'campus-life',
  'The demo campus town square. Post something, vote on something, see how the feed works.',
  'd0000000-0000-4000-8000-000000000010'
);

insert into public.community_posts (id, community_id, author_id, title, body)
values
  ('d0000000-0000-4000-8000-00000000f051',
   'd0000000-0000-4000-8000-00000000c0de',
   'd0000000-0000-4000-8000-000000000010',
   'Welcome to communities',
   'This is a feed: posts, votes, comments. Chat rooms live one tab over. Try the arrows on this post.'),
  ('d0000000-0000-4000-8000-00000000f052',
   'd0000000-0000-4000-8000-00000000c0de',
   'd0000000-0000-4000-8000-000000000010',
   'What would you plant on the quad?',
   'Asking for a friend with a trowel.');

insert into public.post_comments (post_id, author_id, body)
values ('d0000000-0000-4000-8000-00000000f052',
        'd0000000-0000-4000-8000-000000000010',
        'Tomatoes. It is always tomatoes.');
