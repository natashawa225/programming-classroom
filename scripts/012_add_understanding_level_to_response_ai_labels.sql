-- Migration: store richer AI evaluation level per response
-- Adds `understanding_level` to response_ai_labels so we can track:
-- correct | mostly_correct | partially_correct | incorrect | unclear

BEGIN;

ALTER TABLE public.response_ai_labels
  ADD COLUMN IF NOT EXISTS understanding_level TEXT
  CHECK (understanding_level IN ('correct', 'mostly_correct', 'partially_correct', 'incorrect', 'unclear'));

CREATE INDEX IF NOT EXISTS idx_response_ai_labels_understanding_level
ON public.response_ai_labels(understanding_level);

COMMIT;

