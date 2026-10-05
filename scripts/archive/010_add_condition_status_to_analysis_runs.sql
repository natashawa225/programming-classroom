-- Migration: store session condition + status snapshots on analysis_runs
-- Adds:
-- - condition (baseline/treatment)
-- - session_status (draft/live/analysis_ready/revision/closed)
--
-- Safe to run multiple times.

BEGIN;

ALTER TABLE public.analysis_runs
  ADD COLUMN IF NOT EXISTS condition TEXT CHECK (condition IN ('baseline', 'treatment')),
  ADD COLUMN IF NOT EXISTS session_status TEXT;

CREATE INDEX IF NOT EXISTS idx_analysis_runs_condition
ON public.analysis_runs(condition);

COMMIT;

