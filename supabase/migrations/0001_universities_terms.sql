-- Huddl schema: universities and academic terms
-- Every Huddl community is scoped to a university, matched by email domain.

create extension if not exists citext;

create table public.universities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  short_name   text not null,
  email_domain citext not null unique,
  city         text,
  state        text,
  created_at   timestamptz not null default now()
);

create table public.terms (
  id            uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name          text not null,
  starts_on     date not null,
  ends_on       date not null,
  is_current    boolean not null default false,
  unique (university_id, name)
);

alter table public.universities enable row level security;
alter table public.terms enable row level security;

-- Universities are world-readable so the signup page can tell users whether
-- their school is supported before they create an account.
create policy "universities are readable by everyone"
  on public.universities for select
  using (true);

create policy "terms are readable by authenticated users"
  on public.terms for select
  to authenticated
  using (true);
