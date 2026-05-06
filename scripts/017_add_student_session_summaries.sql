-- Migration: cache per-student end-of-session summaries
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.student_session_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  session_participant_id UUID NOT NULL REFERENCES public.session_participants(session_participant_id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  summary_json JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('local', 'mixed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, session_participant_id)
);

CREATE INDEX IF NOT EXISTS idx_student_session_summaries_session_participant_id
ON public.student_session_summaries(session_participant_id);

CREATE OR REPLACE FUNCTION public.set_student_session_summaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_student_session_summaries_updated_at ON public.student_session_summaries;

CREATE TRIGGER trg_student_session_summaries_updated_at
BEFORE UPDATE ON public.student_session_summaries
FOR EACH ROW
EXECUTE FUNCTION public.set_student_session_summaries_updated_at();

COMMIT;
