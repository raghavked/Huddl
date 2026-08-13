-- Hearth seed: structural data only — no sample content. Courses, clubs and
-- everything else come from users. Universities are the allow-list that makes
-- "verified per university" work; default campus channels are product
-- infrastructure every campus starts with.
--
-- Rollout order: UC Davis first, then the rest of the UC system, then CSUs
-- (see docs/OPERATIONS.md). Add a CSU by inserting its row here.

insert into public.universities (name, short_name, email_domain, city, state) values
  ('University of California, Davis', 'UC Davis', 'ucdavis.edu', 'Davis', 'CA'),
  ('University of California, Berkeley', 'UC Berkeley', 'berkeley.edu', 'Berkeley', 'CA'),
  ('University of California, Los Angeles', 'UCLA', 'ucla.edu', 'Los Angeles', 'CA'),
  ('University of California, San Diego', 'UC San Diego', 'ucsd.edu', 'La Jolla', 'CA'),
  ('University of California, Irvine', 'UC Irvine', 'uci.edu', 'Irvine', 'CA'),
  ('University of California, Santa Barbara', 'UC Santa Barbara', 'ucsb.edu', 'Santa Barbara', 'CA'),
  ('University of California, Santa Cruz', 'UC Santa Cruz', 'ucsc.edu', 'Santa Cruz', 'CA'),
  ('University of California, Riverside', 'UC Riverside', 'ucr.edu', 'Riverside', 'CA'),
  ('University of California, Merced', 'UC Merced', 'ucmerced.edu', 'Merced', 'CA')
on conflict (email_domain) do nothing;

-- Default campus channels — every student is auto-joined at signup.
insert into public.channels (university_id, kind, name, slug, description, is_default)
select u.id, 'campus', c.name, c.slug, c.description, true
from public.universities u
cross join (values
  ('general', 'general', 'Campus-wide chat — say hi!'),
  ('study-buddies', 'study-buddies', 'Find people to study with'),
  ('campus-events', 'campus-events', 'What''s happening on campus'),
  ('asks-and-offers', 'asks-and-offers', 'Textbooks, rides, sublets, help')
) as c(name, slug, description)
on conflict (university_id, slug) do nothing;

-- Current academic term per campus (UC quarter system; Berkeley/Merced run
-- semesters). Used only to group courses; safe to adjust each term.
insert into public.terms (university_id, name, starts_on, ends_on, is_current)
select u.id,
       case when u.email_domain in ('berkeley.edu', 'ucmerced.edu')
            then 'Fall 2026' else 'Fall Quarter 2026' end,
       case when u.email_domain in ('berkeley.edu', 'ucmerced.edu')
            then date '2026-08-26' else date '2026-09-21' end,
       case when u.email_domain in ('berkeley.edu', 'ucmerced.edu')
            then date '2026-12-18' else date '2026-12-11' end,
       true
from public.universities u
on conflict (university_id, name) do nothing;
