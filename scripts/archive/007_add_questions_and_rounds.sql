-- Migration: multi-question sessions + per-question responses with rounds
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Session questions
CREATE TABLE IF NOT EXISTS public.session_questions (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  position INT NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT,
  timer_seconds INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_session_questions_session
ON public.session_questions(session_id, position);

-- 2) Responses: add question_id + time_taken_seconds + original_response_id
ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS question_id UUID;

ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS time_taken_seconds INT;

ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS original_response_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'responses_question_id_fkey'
  ) THEN
    EXECUTE '
      ALTER TABLE public.responses
      ADD CONSTRAINT responses_question_id_fkey
      FOREIGN KEY (question_id)
      REFERENCES public.session_questions(question_id)
      ON DELETE CASCADE
    ';
  END IF;
END $$;

-- Optional FK (self-reference) for revision link
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'responses_original_response_id_fkey'
  ) THEN
    EXECUTE '
      ALTER TABLE public.responses
      ADD CONSTRAINT responses_original_response_id_fkey
      FOREIGN KEY (original_response_id)
      REFERENCES public.responses(response_id)
      ON DELETE SET NULL
    ';
  END IF;
END $$;

-- 3) Uniqueness: one response per participant per question per round
-- Drop legacy uniqueness index if it exists (name may vary); create new scoped index.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_responses_session_participant_round') THEN
    EXECUTE 'DROP INDEX public.uniq_responses_session_participant_round;';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_responses_session_participant_question_round
ON public.responses(session_id, session_participant_id, question_id, round_number);

CREATE INDEX IF NOT EXISTS idx_responses_session_question_round
ON public.responses(session_id, question_id, round_number);

COMMIT;

