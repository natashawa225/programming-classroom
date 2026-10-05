-- Seed sample classroom experiment data (for manual/local testing)
-- Creates:
-- - 1 baseline session with 4 union-find questions
-- - 1 treatment session with 4 union-find questions
-- - 30 participants join each session
--   - baseline uses p001-p030
--   - treatment uses p101-p130
-- - Round 1 responses for both sessions
-- - Round 2 responses for treatment session (revision) for half the participants (Q2/Q3 only)
--
-- Assumes participants table already contains p001-p200.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Baseline session
INSERT INTO public.sessions (session_code, condition, question, answer_options, correct_answer, status, live_phase, current_question_position)
VALUES ('BASELINE-DEMO', 'baseline', 'Demo session (baseline)', '[]'::jsonb, 'N/A', 'closed', 'session_completed', 4)
ON CONFLICT (session_code) DO UPDATE SET condition=EXCLUDED.condition
RETURNING id
\gset

-- Questions (4) - union-find lecture set
INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
VALUES
  (:'id', 1, 'Connected components: If A is connected to B and B is connected to C, what can you conclude about A and C? Explain.', 'Connectivity is transitive: A is connected to C (same component) if there is a path.', 90),
  (:'id', 2, 'QuickFind: What does the `id[]` array represent, and what changes during union(p, q)?', '`id[i]` is the component identifier for i; union scans and relabels all entries of one component to the other.', 120),
  (:'id', 3, 'QuickUnion: What is a “root”, and what does union(p, q) do conceptually?', 'Find roots of p and q and link one root to the other, merging whole components.', 120),
  (:'id', 4, 'Weighted QuickUnion: Why does linking smaller tree to larger improve performance? What performance guarantee does it give?', 'It keeps tree height logarithmic (~log N), speeding up find; union links smaller size/rank to larger.', 120)
ON CONFLICT (session_id, position) DO NOTHING;

-- Treatment session
INSERT INTO public.sessions (session_code, condition, question, answer_options, correct_answer, status, live_phase, current_question_position)
VALUES ('TREATMENT-DEMO', 'treatment', 'Demo session (treatment)', '[]'::jsonb, 'N/A', 'closed', 'session_completed', 4)
ON CONFLICT (session_code) DO UPDATE SET condition=EXCLUDED.condition
RETURNING id
\gset id2

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
VALUES
  (:'id2', 1, 'Connected components: If A is connected to B and B is connected to C, what can you conclude about A and C? Explain.', 'Connectivity is transitive: A is connected to C (same component) if there is a path.', 90),
  (:'id2', 2, 'QuickFind: What does the `id[]` array represent, and what changes during union(p, q)?', '`id[i]` is the component identifier for i; union scans and relabels all entries of one component to the other.', 120),
  (:'id2', 3, 'QuickUnion: What is a “root”, and what does union(p, q) do conceptually?', 'Find roots of p and q and link one root to the other, merging whole components.', 120),
  (:'id2', 4, 'Weighted QuickUnion: Why does linking smaller tree to larger improve performance? What performance guarantee does it give?', 'It keeps tree height logarithmic (~log N), speeding up find; union links smaller size/rank to larger.', 120)
ON CONFLICT (session_id, position) DO NOTHING;

-- Join baseline (p001-p030) and treatment (p101-p130)
WITH base AS (
  SELECT :'id'::uuid AS session_id, gs AS n
  FROM generate_series(1, 30) gs
),
trt AS (
  SELECT :'id2'::uuid AS session_id, gs AS n
  FROM generate_series(1, 30) gs
),
allj AS (
  SELECT * FROM base
  UNION ALL
  SELECT * FROM trt
)
INSERT INTO public.session_participants (session_id, participant_id, anonymized_label)
SELECT
  j.session_id,
  CASE
    WHEN j.session_id = :'id'::uuid THEN 'p' || lpad(j.n::text, 3, '0')
    ELSE 'p' || lpad((100 + j.n)::text, 3, '0')
  END AS participant_id,
  'P' || lpad(j.n::text, 2, '0') AS anonymized_label
FROM allj j
ON CONFLICT (session_id, participant_id) DO NOTHING;

-- Round 1 responses (union-find misconception patterns)
-- Q1: transitivity; common wrong: "only direct"
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, attempt_type, round_number, answer, confidence)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'main',
  'initial',
  1,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 4) = 0 THEN 'A and C are connected only if there is a direct edge between them.'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 1 THEN 'If A-B and B-C then A is connected to C (same component).'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 2 THEN 'Not necessarily; depends whether A connects directly to C.'
    ELSE 'Yes, transitive: path A→B→C means A and C are connected.'
  END AS answer,
  ((substring(sp.participant_id from 2)::int % 5) + 1) AS confidence
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 1
JOIN public.session_participants sp ON sp.session_id = s.id
WHERE s.session_code IN ('BASELINE-DEMO','TREATMENT-DEMO')
ON CONFLICT DO NOTHING;

-- Q2: QuickFind id[] meaning; common wrong: parent pointers / tree
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, attempt_type, round_number, answer, confidence)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'main',
  'initial',
  1,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 4) = 0 THEN 'id[i] stores the parent pointer to build a tree; union just links p to q.'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 1 THEN 'id[i] is the component id. union changes ids of one component to match the other.'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 2 THEN 'It stores which group you are in; union scans and updates many entries.'
    ELSE 'id[] is like parents; you update a root pointer.'
  END AS answer,
  ((substring(sp.participant_id from 2)::int % 5) + 1) AS confidence
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 2
JOIN public.session_participants sp ON sp.session_id = s.id
WHERE s.session_code IN ('BASELINE-DEMO','TREATMENT-DEMO')
ON CONFLICT DO NOTHING;

-- Q3: QuickUnion root + union behavior; common wrong: link p to q only
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, attempt_type, round_number, answer, confidence)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'main',
  'initial',
  1,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 3) = 0 THEN 'Root is the last item added. union connects p directly to q.'
    WHEN (substring(sp.participant_id from 2)::int % 3) = 1 THEN 'Root is an element that points to itself. union links one root to the other.'
    ELSE 'You find the roots and attach one tree under the other to merge components.'
  END AS answer,
  ((substring(sp.participant_id from 2)::int % 5) + 1) AS confidence
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 3
JOIN public.session_participants sp ON sp.session_id = s.id
WHERE s.session_code IN ('BASELINE-DEMO','TREATMENT-DEMO')
ON CONFLICT DO NOTHING;

-- Q4: Weighted QuickUnion; common wrong: same as path compression / no effect
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, attempt_type, round_number, answer, confidence)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'main',
  'initial',
  1,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 4) = 0 THEN 'Weighting is the same as path compression.'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 1 THEN 'Attach smaller tree under larger so height stays about log N.'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 2 THEN 'It makes union faster but find is still linear.'
    ELSE 'Keep trees balanced by size/rank to avoid tall chains.'
  END AS answer,
  ((substring(sp.participant_id from 2)::int % 5) + 1) AS confidence
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 4
JOIN public.session_participants sp ON sp.session_id = s.id
WHERE s.session_code IN ('BASELINE-DEMO','TREATMENT-DEMO')
ON CONFLICT DO NOTHING;

-- Round 2 revision for treatment: participants 1-15 revise Q2 and Q3 (some improve)
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, attempt_type, round_number, answer, confidence, original_response_id)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'revision',
  'revision',
  2,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 4) = 0 THEN 'id[i] is the component id (not a parent). union scans and updates ids for one component.'
    ELSE r1.answer
  END AS answer,
  4 AS confidence,
  r1.response_id AS original_response_id
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 2
JOIN public.session_participants sp ON sp.session_id = s.id
JOIN public.responses r1
  ON r1.session_id = s.id
 AND r1.session_participant_id = sp.session_participant_id
 AND r1.question_id = q.question_id
 AND r1.round_number = 1
WHERE s.session_code = 'TREATMENT-DEMO'
  AND substring(sp.participant_id from 2)::int BETWEEN 101 AND 115
ON CONFLICT DO NOTHING;

INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, attempt_type, round_number, answer, confidence, original_response_id)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'revision',
  'revision',
  2,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 3) = 0 THEN 'Find roots of p and q and link one root to the other (merges whole components).'
    ELSE r1.answer
  END AS answer,
  4 AS confidence,
  r1.response_id AS original_response_id
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 3
JOIN public.session_participants sp ON sp.session_id = s.id
JOIN public.responses r1
  ON r1.session_id = s.id
 AND r1.session_participant_id = sp.session_participant_id
 AND r1.question_id = q.question_id
 AND r1.round_number = 1
WHERE s.session_code = 'TREATMENT-DEMO'
  AND substring(sp.participant_id from 2)::int BETWEEN 101 AND 115
ON CONFLICT DO NOTHING;

COMMIT;
