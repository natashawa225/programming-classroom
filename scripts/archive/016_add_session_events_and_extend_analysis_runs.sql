-- Migration: add lightweight session event logging + richer analysis run replay data
-- Safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS public.session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'session_started',
      'question_opened',
      'question_closed',
      'revision_opened',
      'revision_closed',
      'analysis_generated'
    )
  ),
  round_number INT NOT NULL DEFAULT 1 CHECK (round_number IN (1, 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id
ON public.session_events(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_events_session_question
ON public.session_events(session_id, question_id, round_number, created_at DESC);

ALTER TABLE public.analysis_runs
  ADD COLUMN IF NOT EXISTS question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS analysis_json JSONB,
  ADD COLUMN IF NOT EXISTS model_name TEXT;

CREATE INDEX IF NOT EXISTS idx_analysis_runs_session_question_round
ON public.analysis_runs(session_id, question_id, round_number, created_at DESC);

COMMIT;
