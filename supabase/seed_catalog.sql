-- Catalog seed: real UC Davis courses (public registrar data, structured
-- the way community catalogs like Cattlelog present it). Offerings are
-- seeded for the current summer session (subset) and Fall Quarter 2026
-- (all). Refresh per term from registrar/community data with source set
-- accordingly. Idempotent: on conflict do nothing.

-- The term running right now, so catalog verification works today.
insert into public.terms (university_id, name, starts_on, ends_on)
select u.id, 'Summer Session II 2026', date '2026-08-03', date '2026-09-11'
from public.universities u where u.short_name = 'UC Davis'
on conflict (university_id, name) do nothing;

with u as (
  select id from public.universities where short_name = 'UC Davis'
),
data (subject_code, course_number, title, units) as (
  values
  ('MAT', '16A', 'Short Calculus', 3.0),
  ('MAT', '16B', 'Short Calculus', 3.0),
  ('MAT', '17A', 'Calculus for Biology and Medicine', 4.0),
  ('MAT', '17B', 'Calculus for Biology and Medicine', 4.0),
  ('MAT', '17C', 'Calculus for Biology and Medicine', 4.0),
  ('MAT', '21A', 'Calculus', 4.0),
  ('MAT', '21B', 'Calculus', 4.0),
  ('MAT', '21C', 'Calculus', 4.0),
  ('MAT', '21D', 'Vector Analysis', 4.0),
  ('MAT', '22A', 'Linear Algebra', 3.0),
  ('MAT', '22B', 'Differential Equations', 3.0),
  ('MAT', '108', 'Introduction to Abstract Mathematics', 4.0),
  ('MAT', '125A', 'Real Analysis', 4.0),
  ('MAT', '135A', 'Probability', 4.0),
  ('ECS', '20', 'Discrete Mathematics for Computer Science', 4.0),
  ('ECS', '32A', 'Introduction to Programming', 4.0),
  ('ECS', '32B', 'Introduction to Data Structures', 4.0),
  ('ECS', '36A', 'Programming and Problem Solving', 4.0),
  ('ECS', '36B', 'Software Development and Object-Oriented Programming', 4.0),
  ('ECS', '36C', 'Data Structures, Algorithms, and Programming', 4.0),
  ('ECS', '50', 'Computer Organization and Machine-Dependent Programming', 4.0),
  ('ECS', '120', 'Theory of Computation', 4.0),
  ('ECS', '122A', 'Algorithm Design and Analysis', 4.0),
  ('ECS', '140A', 'Programming Languages', 4.0),
  ('ECS', '150', 'Operating Systems and System Programming', 4.0),
  ('ECS', '154A', 'Computer Architecture', 4.0),
  ('ECS', '160', 'Software Engineering', 4.0),
  ('ECS', '165A', 'Database Systems', 4.0),
  ('ECS', '170', 'Introduction to Artificial Intelligence', 4.0),
  ('ECS', '171', 'Machine Learning', 4.0),
  ('CHE', '2A', 'General Chemistry', 5.0),
  ('CHE', '2B', 'General Chemistry', 5.0),
  ('CHE', '2C', 'General Chemistry', 5.0),
  ('CHE', '8A', 'Organic Chemistry: Brief Course', 2.0),
  ('CHE', '8B', 'Organic Chemistry: Brief Course', 4.0),
  ('CHE', '118A', 'Organic Chemistry for Health and Life Sciences', 4.0),
  ('CHE', '118B', 'Organic Chemistry for Health and Life Sciences', 4.0),
  ('CHE', '118C', 'Organic Chemistry for Health and Life Sciences', 4.0),
  ('BIS', '2A', 'Introduction to Biology: Essentials of Life on Earth', 5.0),
  ('BIS', '2B', 'Introduction to Biology: Principles of Ecology and Evolution', 5.0),
  ('BIS', '2C', 'Introduction to Biology: Biodiversity and the Tree of Life', 5.0),
  ('BIS', '101', 'Genes and Gene Expression', 4.0),
  ('BIS', '104', 'Cell Biology', 3.0),
  ('NPB', '101', 'Systemic Physiology', 5.0),
  ('NPB', '110', 'Fundamentals of Neurobiology', 4.0),
  ('MIC', '102', 'Introductory Microbiology', 3.0),
  ('ECON', '1A', 'Principles of Microeconomics', 4.0),
  ('ECON', '1B', 'Principles of Macroeconomics', 4.0),
  ('ECON', '100A', 'Intermediate Microeconomic Theory', 4.0),
  ('ECON', '100B', 'Intermediate Macroeconomic Theory', 4.0),
  ('ECON', '102', 'Analysis of Economic Data', 4.0),
  ('ECON', '140', 'Econometrics', 4.0),
  ('STA', '13', 'Elementary Statistics', 4.0),
  ('STA', '32', 'Gateway to Statistical Data Science', 4.0),
  ('STA', '100', 'Applied Statistics for the Biological Sciences', 4.0),
  ('STA', '106', 'Applied Statistical Methods: Analysis of Variance', 4.0),
  ('STA', '108', 'Applied Statistical Methods: Regression Analysis', 4.0),
  ('STA', '131A', 'Introduction to Probability Theory', 4.0),
  ('PHY', '7A', 'General Physics', 4.0),
  ('PHY', '7B', 'General Physics', 4.0),
  ('PHY', '7C', 'General Physics', 4.0),
  ('PHY', '9A', 'Classical Physics', 5.0),
  ('PHY', '9B', 'Classical Physics', 5.0),
  ('PHY', '9C', 'Classical Physics', 5.0),
  ('PHY', '9D', 'Modern Physics', 4.0),
  ('PSC', '1', 'General Psychology', 4.0),
  ('PSC', '41', 'Research Methods in Psychology', 4.0),
  ('PSC', '100', 'Cognitive Psychology', 4.0),
  ('PSC', '101', 'Behavioral Neuroscience', 4.0),
  ('COM', '1', 'Major Works of the Ancient World', 4.0),
  ('COM', '2', 'Major Works of the Medieval and Early Modern World', 4.0),
  ('COM', '3', 'Major Works of the Modern World', 4.0),
  ('COM', '4', 'Major Works of the Contemporary World', 4.0),
  ('UWP', '1', 'Introduction to Academic Literacies', 4.0),
  ('UWP', '101', 'Advanced Composition', 4.0),
  ('UWP', '102B', 'Writing in the Disciplines: Biological Sciences', 4.0),
  ('ENL', '3', 'Introduction to Literature', 4.0),
  ('POL', '1', 'Introduction to American Politics', 4.0),
  ('POL', '2', 'Introduction to Comparative Politics', 4.0),
  ('POL', '3', 'Introduction to International Relations', 4.0),
  ('HIS', '17A', 'History of the United States to the Civil War', 4.0),
  ('HIS', '17B', 'History of the United States since the Civil War', 4.0),
  ('ANT', '1', 'Human Evolutionary Biology', 4.0),
  ('ANT', '2', 'Cultural Anthropology', 4.0),
  ('SOC', '1', 'Introduction to Sociology', 4.0),
  ('CMN', '1', 'Introduction to Public Speaking', 4.0),
  ('CMN', '101', 'Communication Theories', 4.0),
  ('DES', '1', 'Introduction to Design', 4.0),
  ('DES', '16', 'Design and the Computer', 4.0),
  ('MGT', '11A', 'Elementary Accounting', 4.0),
  ('MGT', '11B', 'Elementary Accounting', 4.0),
  ('EAE', '130A', 'Aircraft Performance and Design', 4.0),
  ('ENG', '6', 'Engineering Problem Solving', 4.0),
  ('ENG', '17', 'Circuits I', 4.0),
  ('ENG', '35', 'Statics', 4.0)
)
insert into public.catalog_courses (university_id, subject_code, course_number, title, units)
select u.id, d.subject_code, d.course_number, d.title, d.units
from u, data d
on conflict (university_id, subject_code, course_number) do nothing;

-- Fall Quarter 2026: everything above is offered.
insert into public.catalog_offerings (catalog_course_id, term_id, source)
select c.id, t.id, 'seed'
from public.catalog_courses c
join public.universities u on u.id = c.university_id and u.short_name = 'UC Davis'
join public.terms t on t.university_id = u.id and t.name = 'Fall Quarter 2026'
on conflict (catalog_course_id, term_id) do nothing;

-- Summer Session II 2026: the realistic subset that actually runs in
-- summer — lower-division series and a few workhorse uppers. Everything
-- else stays searchable but shows as "not offered this session".
insert into public.catalog_offerings (catalog_course_id, term_id, source)
select c.id, t.id, 'seed'
from public.catalog_courses c
join public.universities u on u.id = c.university_id and u.short_name = 'UC Davis'
join public.terms t on t.university_id = u.id and t.name = 'Summer Session II 2026'
where (c.subject_code, c.course_number) in (
  ('MAT','16A'),('MAT','16B'),('MAT','17A'),('MAT','21A'),('MAT','21B'),('MAT','21C'),('MAT','22A'),('MAT','22B'),
  ('ECS','32A'),('ECS','32B'),('ECS','36A'),('ECS','36B'),('ECS','50'),('ECS','154A'),('ECS','170'),
  ('CHE','2A'),('CHE','2B'),('CHE','2C'),('CHE','118A'),('CHE','118B'),
  ('BIS','2A'),('BIS','2B'),('BIS','101'),
  ('ECON','1A'),('ECON','1B'),('ECON','100A'),
  ('STA','13'),('STA','100'),('STA','108'),
  ('PHY','7A'),('PHY','7B'),('PHY','9A'),('PHY','9B'),
  ('PSC','1'),('PSC','41'),
  ('UWP','1'),('UWP','101'),
  ('COM','1'),('COM','3'),
  ('POL','1'),('HIS','17B'),('ANT','2'),('SOC','1'),('CMN','1'),
  ('NPB','101'),('MIC','102'),('MGT','11A')
)
on conflict (catalog_course_id, term_id) do nothing;
