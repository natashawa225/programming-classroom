-- Migration: AI analysis runs + per-response labels
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.analysis_runs (
  analysis_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number IN (1, 2)),
  model TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  error_message TEXT,
  prompt_json JSONB,
  raw_response_json JSONB,
  summary_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, round_number, created_at)
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_session_round
ON public.analysis_runs(session_id, round_number, created_at DESC);

CREATE TABLE IF NOT EXISTS public.response_ai_labels (
  response_ai_label_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id UUID REFERENCES public.analysis_runs(analysis_run_id) ON DELETE CASCADE,
  response_id UUID REFERENCES public.responses(response_id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number IN (1, 2)),
  understanding_level TEXT CHECK (understanding_level IN ('correct', 'mostly_correct', 'partially_correct', 'incorrect', 'unclear')),
  is_correct BOOLEAN,
  misconception_label TEXT,
  cluster_id TEXT,
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(analysis_run_id, response_id)
);

CREATE INDEX IF NOT EXISTS idx_response_ai_labels_session_round
ON public.response_ai_labels(session_id, round_number);

CREATE INDEX IF NOT EXISTS idx_response_ai_labels_question_round
ON public.response_ai_labels(question_id, round_number);

COMMIT;
