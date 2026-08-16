-- Hearth moderation: slurs flag themselves.
--
-- The report system has always waited for a student to press the button.
-- That is right for almost everything: context decides what's spam, what's
-- harassment, what's a joke between friends. It is wrong for exactly one
-- category. A slur is a slur in every context a campus app has, and the
-- moderators should hear about it even when everyone in the room scrolls
-- past.
--
-- THE LINE THIS DRAWS, PRECISELY: swearing is not moderated. "This exam is
-- fucking brutal" trips nothing, ever, by design; the lexicon contains no
-- profanity, only slurs. And nothing is blocked or hidden: the message
-- sends, the room sees it, and a report lands in the moderators' open queue
-- the same second. Auto-flagging that silently deleted words would be a
-- censor with a false-positive problem; auto-flagging that summons a human
-- is a smoke alarm.
--
-- HOW A FLAG LOOKS: a plain row in `public.reports` with `reporter_id NULL`.
-- Nobody filed it, so nobody's report list shows it (the reporter-scoped
-- select policy checks `reporter_id = auth.uid()`, which is never true of
-- null), the hourly report rate limit never counts it (same comparison), and
-- moderators see it in the same queue as everything else. Clients render the
-- missing reporter as "Hearth flagged this automatically".
--
-- WHERE IT LISTENS: every surface where one student talks at others.
-- Channel messages, direct messages, board posts, club announcements, and
-- profile text (display name, bio, looking-for). Private-to-me text (notes
-- to self, grades, flashcards) is not communication and is not scanned.
--
-- THE LEXICON lives in `public.moderation_terms`, a deny-all table only the
-- service role can read or edit, so the list is maintainable without a
-- migration and is never shipped to clients or enumerable through the API.
-- Matching is word-boundary over normalised text (lowercased, common digit/
-- symbol substitutions folded, censoring asterisks dropped), with plural
-- forms allowed, so "n1gger", "f@ggot" and "F*ggots" all land while
-- "conspicuous" and "class" never can.
--
-- False positives are the moderator's to dismiss, and that is the design:
-- a handful of "chink in the armour" dismissals is the price of never
-- missing the real thing.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · reports grow a null reporter: "Hearth itself"
-- ═══════════════════════════════════════════════════════════════════════

alter table public.reports alter column reporter_id drop not null;

comment on column public.reports.reporter_id is
  'The student who filed it, or NULL for a report Hearth filed automatically '
  '(the slur auto-flag). Null-reporter rows are visible only to moderators.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · the lexicon: service-role only, never client-readable
-- ═══════════════════════════════════════════════════════════════════════

create table public.moderation_terms (
  term text primary key,
  created_at timestamptz not null default now()
);

comment on table public.moderation_terms is
  'Slur lexicon for the auto-flag. Lowercase base forms; matching adds word '
  'boundaries, plural endings, and digit/symbol normalisation. Deny-all RLS '
  'on purpose: the service role curates it, clients can never read it.';

alter table public.moderation_terms enable row level security;
-- No policies, and no privileges either (the 0043 shape): deny-all twice.
revoke all on public.moderation_terms from public, anon, authenticated;

insert into public.moderation_terms (term) values
  ('nigger'), ('nigga'), ('niglet'), ('jigaboo'), ('pickaninny'),
  ('darkie'), ('golliwog'), ('porch monkey'), ('jungle bunny'), ('sambo'),
  ('coon'), ('tar baby'),
  ('spic'), ('wetback'), ('beaner'),
  ('gook'), ('chink'), ('chinky'), ('jap'), ('chinaman'),
  ('kike'), ('yid'), ('hymie'), ('shylock'),
  ('raghead'), ('towelhead'), ('muzzie'), ('sandnigger'), ('sand nigger'),
  ('paki'),
  ('injun'), ('squaw'), ('redskin'),
  ('polack'), ('wop'), ('dago'), ('honky'),
  ('halfbreed'), ('half breed'),
  ('faggot'), ('fag'), ('dyke'), ('fudgepacker'), ('carpet muncher'),
  ('tranny'), ('shemale'), ('ladyboy'),
  ('retard'), ('retarded'), ('mongoloid'), ('midget');

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · matching: normalise, then look for any term on a word boundary
-- ═══════════════════════════════════════════════════════════════════════

-- Two readings of the same text, concatenated, so one regex pass covers
-- both of the ways people actually type these words:
--
--   READING ONE lowercases and turns every non-alphanumeric run into a
--   single space, then folds look-alike digits (0→o, 1→i, 3→e, 4→a, 5→s,
--   7→t, 8→b). This is the one that catches ordinary text and digit swaps
--   with punctuation attached: "sp1c." and "n1gger!" both land, and a
--   trailing "!" can never weld itself onto a word as a letter.
--
--   READING TWO folds the symbol substitutions in place (@→a, $→s, !→i)
--   and drops censoring asterisks, catching "f@ggot", "n!gga", "k!ke" and
--   separator games like "f*a*g".
--
-- Neither reading reconstructs starred-out vowels ("f*ggot") or letters
-- spaced with dashes ("f-a-g"); that evasion is the moderator's domain,
-- reachable through the report button that has always existed.
create or replace function public.moderation_normalize(p_text text)
returns text
language sql
immutable
as $$
  select translate(
           regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'),
           '0134578', 'oieastb')
         || ' '
         || regexp_replace(
              translate(lower(coalesce(p_text, '')),
                        '0134578@$!*',
                        'oieastbasi'),
              '\s+', ' ', 'g');
$$;

-- The first term found in the text, or null. Plurals ride along: a plain
-- s/es ending always, and for terms ending in y the ies form too (the fleet
-- caught "trannies" sailing past "tranny(s|es)?"). SECURITY DEFINER so it
-- can read the deny-all lexicon; EXECUTE is revoked below so only other
-- definer code (the trigger) can call it: the API can neither scan text nor
-- enumerate the list by probing.
create or replace function public.find_slur(p_text text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select t.term
  from public.moderation_terms t
  where public.moderation_normalize(p_text)
        ~ ('\y' || regexp_replace(t.term, 'y$', '(y|ies)') || '(s|es)?\y')
  limit 1;
$$;

revoke execute on function public.find_slur(text) from public, anon, authenticated;
revoke execute on function public.moderation_normalize(text) from public, anon;

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · the trigger: one flag per row, into the ordinary queue
-- ═══════════════════════════════════════════════════════════════════════

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
    -- A soft-deleted message is already gone from the room; let it lie.
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

  -- One automatic flag per subject, however many times it's edited.
  if exists (
    select 1 from public.reports r
    where r.reporter_id is null
      and case tg_table_name
            when 'messages'      then r.message_id      = new.id
            when 'dm_messages'   then r.dm_message_id   = new.id
            when 'board_posts'   then r.board_post_id   = new.id
            else r.reported_user_id = v_author
                 and r.message_id is null
                 and r.dm_message_id is null
                 and r.board_post_id is null
          end
  ) then
    return new;
  end if;

  insert into public.reports
    (reporter_id, category, reason, status,
     message_id, dm_message_id, board_post_id, reported_user_id)
  values
    (null, 'hate',
     'Flagged automatically: this contains the slur "' || v_term || '". '
       || 'Swearing alone never trips this filter; slurs always do.',
     'open',
     case when tg_table_name = 'messages'    then new.id end,
     case when tg_table_name = 'dm_messages' then new.id end,
     case when tg_table_name = 'board_posts' then new.id end,
     v_author);

  return new;
end;
$$;

create trigger messages_autoflag_slurs
  after insert or update of content on public.messages
  for each row execute function public.autoflag_slurs();

create trigger dm_messages_autoflag_slurs
  after insert or update of content on public.dm_messages
  for each row execute function public.autoflag_slurs();

create trigger board_posts_autoflag_slurs
  after insert or update of title, body on public.board_posts
  for each row execute function public.autoflag_slurs();

create trigger club_announcements_autoflag_slurs
  after insert on public.club_announcements
  for each row execute function public.autoflag_slurs();

create trigger profiles_autoflag_slurs
  after insert or update of display_name, bio, looking_for on public.profiles
  for each row execute function public.autoflag_slurs();
