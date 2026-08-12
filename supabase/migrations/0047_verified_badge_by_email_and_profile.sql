-- Huddl schema: retire the phone badge, and earn the badge with the thing
-- that already proves a student is a student.
--
-- ═══════════════════════════════════════════════════════════════════════
-- Why the phone badge goes
--
-- `profiles.phone_verified_at` was set by an SMS round trip through Twilio,
-- and it gated nothing. `has_verified_phone()` — the function written to
-- read it — has no callers anywhere: not one RLS policy, not one server
-- action, not one line of client code. The badge raised no limit, granted no
-- permission, and changed no default. It was a picture on a profile with a
-- per-message bill and a data processor attached, and the native app had no
-- way to earn one at all.
--
-- ═══════════════════════════════════════════════════════════════════════
-- Why email plus a complete profile is a better badge than a phone number
--
-- A phone number proves someone can receive an SMS. A university email
-- proves they are enrolled at the campus whose rooms they are standing in,
-- which is the only claim this product actually cares about — and Huddl
-- already requires it: `handle_new_user` refuses any signup whose email
-- domain is not a supported university, so the domain check is a database
-- guarantee rather than a form validation.
--
-- Which is also why confirmation ALONE cannot be the badge. Every real
-- account has a confirmed university email; a mark that everyone wears is
-- not a mark. So the badge is confirmation AND a profile with a person
-- behind it, and the second half is what makes it mean something. What it
-- says on a profile is: this is a real student at this school who has filled
-- their page in. That is what a classmate wants to know before answering a
-- direct message from a stranger.
--
-- One operational note, because it is the whole reason this works: email
-- confirmation is only trustworthy once real SMTP is configured. Supabase's
-- built-in sender allows two auth emails an hour, which is a development
-- convenience, not a gate. Configure domain SMTP first (docs/OPERATIONS.md
-- §3c) or this badge is measuring an email nobody could receive.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · What "all their info" means, in exactly one place.
--
--     Every field below is one a real student fills in without being asked
--     twice, and each is a thing an impostor would rather not supply. The
--     display name has to be more than the handle, because the handle is
--     auto-generated from the email's local part at signup — accepting it
--     unchanged would let an untouched profile pass as a filled-in one.
--
--     Deliberately NOT required: `bio`, `interests`, `looking_for`. They are
--     free text, they prove nothing, and demanding them for a trust mark
--     teaches students to type a full stop and move on. Adding or removing a
--     requirement is a one-line change here and nowhere else — the trigger,
--     the backfill and both clients all read this function.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.profile_is_complete(p public.profiles)
returns boolean
language sql immutable
as $$
  select
    coalesce(btrim(p.display_name), '') <> ''
    and lower(btrim(p.display_name)) <> lower(btrim(p.handle::text))
    and coalesce(btrim(p.avatar_url), '') <> ''
    and coalesce(btrim(p.major), '') <> ''
    and p.grad_year is not null;
$$;

comment on function public.profile_is_complete(public.profiles) is
  'Whether a profile carries enough of a person to stand behind the verified badge: a display name that is not merely the auto-generated handle, a photo, a major and a graduation year. The single source of truth for that list — the trigger, the backfill and both clients defer to it. Bio, interests and looking_for are deliberately excluded: free text proves nothing and requiring it only produces junk.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Has this student confirmed the email they signed up with?
--
--     `auth.users` is not readable by `authenticated`, so this is a definer
--     function — and it stays that way. Nothing outside the trigger needs
--     it: a student's own confirmation state is already on the auth user
--     object their client holds, and nobody else's is any of their business.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.email_is_confirmed(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user and u.email_confirmed_at is not null
  );
$$;

comment on function public.email_is_confirmed(uuid) is
  'True when this account has confirmed its university email address. Reads auth.users, so SECURITY DEFINER — and deliberately not granted to anyone: only sync_profile_verified calls it. A student can already see their own confirmation state on their session; another student''s is not theirs to ask about.';

revoke execute on function public.email_is_confirmed(uuid)
  from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · The badge itself.
--
--     A column rather than a view, because every author join in both apps
--     already selects profile columns and a view would mean rewriting all of
--     them. Written only here: `verified_at` is absent from the column-scoped
--     UPDATE grant on `profiles` (0039/0040), so a student cannot set it —
--     and this trigger overwrites whatever arrives anyway, so it could not
--     survive being sent.
--
--     It is recomputed rather than stamped once, so the badge is always
--     currently true. Empty your profile and it goes; fill it back in and it
--     returns with its original date, because `coalesce` keeps the first
--     time you earned it rather than restarting the clock.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists verified_at timestamptz;

comment on column public.profiles.verified_at is
  'When this student last satisfied both halves of the verified badge: a confirmed university email (auth.users.email_confirmed_at) and a complete profile (profile_is_complete). Maintained entirely by the sync_profile_verified trigger and not in the authenticated UPDATE grant, so it cannot be self-awarded. Null means not verified, and the client works out which half is missing.';

create or replace function public.sync_profile_verified()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.profile_is_complete(new) and public.email_is_confirmed(new.id) then
    -- Keep the date they first earned it; only a lapse resets it.
    new.verified_at := coalesce(
      case when tg_op = 'UPDATE' then old.verified_at else null end,
      now()
    );
  else
    new.verified_at := null;
  end if;
  return new;
end;
$$;

comment on function public.sync_profile_verified() is
  'BEFORE INSERT OR UPDATE on profiles. Recomputes verified_at from profile_is_complete and email_is_confirmed, so the badge is a statement about right now rather than about the moment someone clicked a button. Overwrites whatever the client sent, which is what makes the column safe to trust.';

revoke execute on function public.sync_profile_verified()
  from public, anon, authenticated;

drop trigger if exists sync_profile_verified on public.profiles;
create trigger sync_profile_verified
  before insert or update on public.profiles
  for each row execute function public.sync_profile_verified();

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · The other door into the badge: confirming the email.
--
--     The trigger above only fires when the profile row is written. A
--     student who fills their profile in and confirms their email afterwards
--     would sit there complete, confirmed and unbadged until they next
--     edited something. So confirmation nudges the profile, and the trigger
--     above does the thinking.
--
--     It swallows its own errors on purpose. This runs inside the auth
--     system's own write path, and a badge is never worth failing a sign-in
--     or a confirmation over. Worst case the badge waits for the student's
--     next profile edit, which is exactly where it was before this trigger
--     existed.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.sync_verified_on_confirm()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.email_confirmed_at is distinct from old.email_confirmed_at then
    update public.profiles set updated_at = now() where id = new.id;
  end if;
  return new;
exception
  when others then
    return new;
end;
$$;

comment on function public.sync_verified_on_confirm() is
  'AFTER UPDATE on auth.users. When an account confirms (or re-confirms) its email, touch the profile so sync_profile_verified re-evaluates the badge. Errors are swallowed deliberately: this runs inside the auth write path and a trust badge must never be able to fail a sign-in.';

drop trigger if exists sync_verified_on_confirm on auth.users;
create trigger sync_verified_on_confirm
  after update on auth.users
  for each row execute function public.sync_verified_on_confirm();

-- ═══════════════════════════════════════════════════════════════════════
-- 5 · Work out the badge for everyone who already exists.
--
--     A plain touch rather than a hand-written UPDATE, so the backfill and
--     the steady state are computed by the same code and cannot disagree.
-- ═══════════════════════════════════════════════════════════════════════

update public.profiles set updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════
-- 6 · Take the phone apparatus out.
--
--     In dependency order: the reader before the column it reads, the column
--     before nothing, and the table last. `phone_verifications` holds no
--     rows, `has_verified_phone()` has no callers, and `phone_verified_at`
--     is on two profiles, both of them test accounts — so nothing real is
--     lost. `export_my_data` never referenced any of it, so the export is
--     unaffected.
-- ═══════════════════════════════════════════════════════════════════════

drop function if exists public.has_verified_phone();

alter table public.profiles drop column if exists phone_verified_at;

drop table if exists public.phone_verifications;
