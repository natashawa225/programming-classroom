-- Migration: store baseline-style response quality category per response label
-- Adds:
-- - evaluation_category: fully_correct | partially_correct | relevant_incomplete | misconception | unclear
-- - reasoning_summary: short text justification (teacher-facing)

BEGIN;

ALTER TABLE public.response_ai_labels
  ADD COLUMN IF NOT EXISTS evaluation_category TEXT
  CHECK (evaluation_category IN ('fully_correct', 'partially_correct', 'relevant_incomplete', 'misconception', 'unclear'));

ALTER TABLE public.response_ai_labels
  ADD COLUMN IF NOT EXISTS reasoning_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_response_ai_labels_evaluation_category
ON public.response_ai_labels(evaluation_category);

COMMIT;

