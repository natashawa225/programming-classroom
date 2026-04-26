-- Migration: store teacher session summaries
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.session_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  summary_json JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('openai', 'fallback')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id
ON public.session_summaries(session_id);

CREATE OR REPLACE FUNCTION public.set_session_summaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_summaries_updated_at ON public.session_summaries;

CREATE TRIGGER trg_session_summaries_updated_at
BEFORE UPDATE ON public.session_summaries
FOR EACH ROW
EXECUTE FUNCTION public.set_session_summaries_updated_at();

COMMIT;
