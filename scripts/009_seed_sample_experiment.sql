-- Seed sample classroom experiment data (for manual/local testing)
-- Creates:
-- - 1 baseline session with 3 questions
-- - 1 treatment session with 3 questions
-- - 30 participants join each session (p001-p030)
-- - Round 1 responses for both sessions
-- - Round 2 responses for treatment session (revision) for half the participants
--
-- Assumes participants table already contains p001-p030.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Baseline session
INSERT INTO public.sessions (session_code, condition, question, answer_options, correct_answer, status)
VALUES ('BASELINE-DEMO', 'baseline', 'Demo session (baseline)', '[]'::jsonb, 'N/A', 'live')
ON CONFLICT (session_code) DO UPDATE SET condition=EXCLUDED.condition
RETURNING id
\gset

-- Questions (3)
INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
VALUES
  (:'id', 1, 'What is the time complexity of binary search?', 'O(log n)', 90),
  (:'id', 2, 'Explain what a stack is used for.', 'LIFO structure used for function calls / undo / parsing', 120),
  (:'id', 3, 'What does "immutability" mean in programming?', 'Data cannot be changed after creation', 90)
ON CONFLICT (session_id, position) DO NOTHING;

-- Treatment session
INSERT INTO public.sessions (session_code, condition, question, answer_options, correct_answer, status)
VALUES ('TREATMENT-DEMO', 'treatment', 'Demo session (treatment)', '[]'::jsonb, 'N/A', 'live')
ON CONFLICT (session_code) DO UPDATE SET condition=EXCLUDED.condition
RETURNING id
\gset id2

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
VALUES
  (:'id2', 1, 'What is the time complexity of binary search?', 'O(log n)', 90),
  (:'id2', 2, 'Explain what a stack is used for.', 'LIFO structure used for function calls / undo / parsing', 120),
  (:'id2', 3, 'What does "immutability" mean in programming?', 'Data cannot be changed after creation', 90)
ON CONFLICT (session_id, position) DO NOTHING;

-- Join p001-p030 into both sessions
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
  'p' || lpad(j.n::text, 3, '0') AS participant_id,
  'P' || lpad(j.n::text, 2, '0') AS anonymized_label
FROM allj j
ON CONFLICT (session_id, participant_id) DO NOTHING;

-- Round 1 responses (simple clustered wrong answers)
-- Q1: correct O(log n), common wrong: O(n), O(1)
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, round_number, answer, confidence)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'main',
  1,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 5) = 0 THEN 'O(1)'
    WHEN (substring(sp.participant_id from 2)::int % 3) = 0 THEN 'O(n)'
    ELSE 'O(log n)'
  END AS answer,
  ((substring(sp.participant_id from 2)::int % 5) + 1) AS confidence
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 1
JOIN public.session_participants sp ON sp.session_id = s.id
WHERE s.session_code IN ('BASELINE-DEMO','TREATMENT-DEMO')
ON CONFLICT DO NOTHING;

-- Q2: mix of concept answers
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, round_number, answer, confidence)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'main',
  1,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 4) = 0 THEN 'A stack is FIFO like a queue'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 1 THEN 'Used for function call stack and undo'
    WHEN (substring(sp.participant_id from 2)::int % 4) = 2 THEN 'Stores items; last in first out'
    ELSE 'Used for recursion and parsing'
  END AS answer,
  ((substring(sp.participant_id from 2)::int % 5) + 1) AS confidence
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 2
JOIN public.session_participants sp ON sp.session_id = s.id
WHERE s.session_code IN ('BASELINE-DEMO','TREATMENT-DEMO')
ON CONFLICT DO NOTHING;

-- Q3: common wrong: "variables can't change" vs correct "data can't change after creation"
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, round_number, answer, confidence)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'main',
  1,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 3) = 0 THEN 'Variables cannot be changed'
    WHEN (substring(sp.participant_id from 2)::int % 3) = 1 THEN 'Objects are not modified after creation'
    ELSE 'Data cannot change once created'
  END AS answer,
  ((substring(sp.participant_id from 2)::int % 5) + 1) AS confidence
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 3
JOIN public.session_participants sp ON sp.session_id = s.id
WHERE s.session_code IN ('BASELINE-DEMO','TREATMENT-DEMO')
ON CONFLICT DO NOTHING;

-- Round 2 revision for treatment: participants 1-15 revise Q1 only (some improve)
INSERT INTO public.responses (session_id, session_participant_id, question_id, question_type, round_number, answer, confidence, original_response_id)
SELECT
  s.id,
  sp.session_participant_id,
  q.question_id,
  'revision',
  2,
  CASE
    WHEN (substring(sp.participant_id from 2)::int % 5) = 0 THEN 'O(log n)'
    ELSE r1.answer
  END AS answer,
  4 AS confidence,
  r1.response_id AS original_response_id
FROM public.sessions s
JOIN public.session_questions q ON q.session_id = s.id AND q.position = 1
JOIN public.session_participants sp ON sp.session_id = s.id
JOIN public.responses r1
  ON r1.session_id = s.id
 AND r1.session_participant_id = sp.session_participant_id
 AND r1.question_id = q.question_id
 AND r1.round_number = 1
WHERE s.session_code = 'TREATMENT-DEMO'
  AND substring(sp.participant_id from 2)::int BETWEEN 1 AND 15
ON CONFLICT DO NOTHING;

COMMIT;

