-- Huddl seed data: starter university catalog with default campus channels
-- and a current term + sample courses per school. Extend freely — signup just
-- needs the user's email domain to match a universities row.

insert into public.universities (name, short_name, email_domain, city, state) values
  ('University of California, Berkeley', 'UC Berkeley', 'berkeley.edu', 'Berkeley', 'CA'),
  ('Stanford University', 'Stanford', 'stanford.edu', 'Stanford', 'CA'),
  ('Massachusetts Institute of Technology', 'MIT', 'mit.edu', 'Cambridge', 'MA'),
  ('University of Michigan', 'UMich', 'umich.edu', 'Ann Arbor', 'MI'),
  ('University of Texas at Austin', 'UT Austin', 'utexas.edu', 'Austin', 'TX'),
  ('New York University', 'NYU', 'nyu.edu', 'New York', 'NY'),
  ('Georgia Institute of Technology', 'Georgia Tech', 'gatech.edu', 'Atlanta', 'GA'),
  ('University of Washington', 'UW', 'uw.edu', 'Seattle', 'WA'),
  ('University of Illinois Urbana-Champaign', 'UIUC', 'illinois.edu', 'Urbana', 'IL'),
  ('Purdue University', 'Purdue', 'purdue.edu', 'West Lafayette', 'IN')
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

-- Current term for each school.
insert into public.terms (university_id, name, starts_on, ends_on, is_current)
select id, 'Fall 2026', date '2026-08-24', date '2026-12-18', true
from public.universities
on conflict (university_id, name) do nothing;

-- A few sample courses per school so manual course-pick has content in dev.
insert into public.courses (university_id, term_id, code, title)
select u.id, t.id, c.code, c.title
from public.universities u
join public.terms t on t.university_id = u.id and t.is_current
cross join (values
  ('CS 101', 'Introduction to Computer Science'),
  ('MATH 201', 'Multivariable Calculus'),
  ('ECON 110', 'Principles of Economics'),
  ('PSYCH 100', 'Introduction to Psychology'),
  ('ENGL 120', 'College Writing')
) as c(code, title)
on conflict (university_id, term_id, code) do nothing;
