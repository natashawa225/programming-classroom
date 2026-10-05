-- Migration: 023_add_question_reference_answers.sql
-- Supports multiple reference answers/reasoning examples per open-ended question in MeshQuiz
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.question_reference_answers (
  reference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  position INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(question_id, position)
);

CREATE INDEX IF NOT EXISTS idx_question_reference_answers_question
ON public.question_reference_answers(question_id, position);

-- Backfill existing single correct_answer entries from session_questions into question_reference_answers
INSERT INTO public.question_reference_answers (question_id, answer_text, position)
SELECT question_id, correct_answer, 1
FROM public.session_questions
WHERE correct_answer IS NOT NULL AND TRIM(correct_answer) <> ''
ON CONFLICT (question_id, position) DO NOTHING;

COMMIT;
