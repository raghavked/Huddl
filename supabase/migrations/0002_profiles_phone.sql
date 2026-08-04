-- Huddl schema: public profiles + phone verification
-- A profile row is created automatically when a user signs up with a
-- recognized university email domain (see handle_new_user below).

create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  university_id     uuid not null references public.universities(id),
  handle            citext not null unique,
  display_name      text not null,
  avatar_url        text,
  bio               text,
  major             text,
  grad_year         int,
  phone             text,
  phone_verified_at timestamptz,
  is_public         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9_]{3,24}$')
);

create index profiles_university_idx on public.profiles(university_id);

create table public.phone_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  phone       text not null,
  code_hash   text not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create index phone_verifications_user_idx on public.phone_verifications(user_id);

-- Shared helper: the university of the signed-in user. SECURITY DEFINER so
-- policies on other tables can call it without tripping RLS on profiles.
create or replace function public.current_university_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select university_id from public.profiles where id = auth.uid();
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-provision a profile on signup. The email domain must match a
-- supported university (the app enforces this before signup too; this is the
-- backstop that makes "email verified per university" a database guarantee).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  univ_id uuid;
  email_domain text;
  base_handle text;
  candidate text;
  n int := 0;
begin
  email_domain := split_part(new.email, '@', 2);
  select id into univ_id from public.universities where email_domain = split_part(new.email, '@', 2);
  if univ_id is null then
    raise exception 'Unsupported university email domain: %', email_domain;
  end if;

  base_handle := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '', 'g');
  base_handle := substr(coalesce(nullif(base_handle, ''), 'student'), 1, 20);
  if length(base_handle) < 3 then
    base_handle := base_handle || 'student';
  end if;
  candidate := base_handle;
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := base_handle || n::text;
  end loop;

  insert into public.profiles (id, university_id, handle, display_name)
  values (new.id, univ_id, candidate, coalesce(new.raw_user_meta_data->>'display_name', initcap(replace(base_handle, '_', ' '))));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.phone_verifications enable row level security;

-- Profiles are public within the platform (product decision): any signed-in
-- student can view any profile; only the owner can change their own.
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and university_id = public.current_university_id());

create policy "users manage own phone verifications"
  on public.phone_verifications for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
