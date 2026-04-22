-- Migration: live per-question classroom flow
-- Run in Supabase SQL editor as an admin role.

BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS live_phase TEXT NOT NULL DEFAULT 'not_started';

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS current_question_position INT NOT NULL DEFAULT 1;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS current_timer_seconds INT;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ;

ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS attempt_type TEXT;

UPDATE public.responses
SET attempt_type = CASE
  WHEN round_number = 2 OR question_type = 'revision' THEN 'revision'
  ELSE 'initial'
END
WHERE attempt_type IS NULL;

ALTER TABLE public.responses
  ALTER COLUMN attempt_type SET DEFAULT 'initial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'responses_attempt_type_check'
  ) THEN
    EXECUTE '
      ALTER TABLE public.responses
      ADD CONSTRAINT responses_attempt_type_check
      CHECK (attempt_type IN (''initial'', ''revision''))
    ';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_responses_session_question_attempt
ON public.responses(session_id, question_id, attempt_type);

CREATE TABLE IF NOT EXISTS public.live_question_analyses (
  live_question_analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  analysis_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, question_id, attempt_type)
);

CREATE INDEX IF NOT EXISTS idx_live_question_analyses_session
ON public.live_question_analyses(session_id, generated_at DESC);

COMMIT;
