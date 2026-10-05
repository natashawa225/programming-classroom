-- ============================================================================
-- Initial Seeds for MeshQuiz / Programming Classroom
-- Provides sample classroom sessions, questions, and baseline experiment data.
-- ============================================================================

-- Note: To generate participant and teacher credentials, run:
--   node scripts/tools/generate-participant-seed.mjs
--   node scripts/tools/generate-teacher-seed.mjs

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Sample Baseline & Treatment Experiment Sessions
-- ----------------------------------------------------------------------------

-- 1. Baseline session
INSERT INTO public.sessions (session_code, condition, question, answer_options, correct_answer, status, live_phase, current_question_position)
VALUES ('BASELINE-DEMO', 'baseline', 'Demo session (baseline)', '[]'::jsonb, 'N/A', 'closed', 'session_completed', 4)
ON CONFLICT (session_code) DO UPDATE SET condition=EXCLUDED.condition;

-- Questions for Baseline session
INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 1, 'Connected components: If A is connected to B and B is connected to C, what can you conclude about A and C? Explain.', 'Connectivity is transitive: A is connected to C (same component) if there is a path.', 90
FROM public.sessions WHERE session_code = 'BASELINE-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 2, 'QuickFind: What does the `id[]` array represent, and what changes during union(p, q)?', '`id[i]` is the component identifier for i; union scans and relabels all entries of one component to the other.', 120
FROM public.sessions WHERE session_code = 'BASELINE-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 3, 'QuickUnion: What is a “root”, and what does union(p, q) do conceptually?', 'Find roots of p and q and link one root to the other, merging whole components.', 120
FROM public.sessions WHERE session_code = 'BASELINE-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 4, 'Weighted QuickUnion: Why does linking smaller tree to larger improve performance? What performance guarantee does it give?', 'It keeps tree height logarithmic (~log N), speeding up find; union links smaller size/rank to larger.', 120
FROM public.sessions WHERE session_code = 'BASELINE-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

-- 2. Treatment session
INSERT INTO public.sessions (session_code, condition, question, answer_options, correct_answer, status, live_phase, current_question_position)
VALUES ('TREATMENT-DEMO', 'treatment', 'Demo session (treatment)', '[]'::jsonb, 'N/A', 'closed', 'session_completed', 4)
ON CONFLICT (session_code) DO UPDATE SET condition=EXCLUDED.condition;

-- Questions for Treatment session
INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 1, 'Connected components: If A is connected to B and B is connected to C, what can you conclude about A and C? Explain.', 'Connectivity is transitive: A is connected to C (same component) if there is a path.', 90
FROM public.sessions WHERE session_code = 'TREATMENT-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 2, 'QuickFind: What does the `id[]` array represent, and what changes during union(p, q)?', '`id[i]` is the component identifier for i; union scans and relabels all entries of one component to the other.', 120
FROM public.sessions WHERE session_code = 'TREATMENT-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 3, 'QuickUnion: What is a “root”, and what does union(p, q) do conceptually?', 'Find roots of p and q and link one root to the other, merging whole components.', 120
FROM public.sessions WHERE session_code = 'TREATMENT-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

INSERT INTO public.session_questions (session_id, position, prompt, correct_answer, timer_seconds)
SELECT id, 4, 'Weighted QuickUnion: Why does linking smaller tree to larger improve performance? What performance guarantee does it give?', 'It keeps tree height logarithmic (~log N), speeding up find; union links smaller size/rank to larger.', 120
FROM public.sessions WHERE session_code = 'TREATMENT-DEMO'
ON CONFLICT (session_id, position) DO NOTHING;

COMMIT;
