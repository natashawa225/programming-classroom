-- Migration: allow queued/running analysis run status values
-- Updates analysis_runs.status check constraint to:
-- ('queued', 'running', 'completed', 'failed')
--
-- Safe to run once; if your constraint has a different name, adjust DROP CONSTRAINT accordingly.

BEGIN;

ALTER TABLE public.analysis_runs
  DROP CONSTRAINT IF EXISTS analysis_runs_status_check;

ALTER TABLE public.analysis_runs
  ADD CONSTRAINT analysis_runs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed'));

COMMIT;

