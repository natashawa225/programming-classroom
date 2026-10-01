-- Migration: 024_add_monitoring_goals.sql
-- Supports Teacher-Authored Persistent Monitoring Goals seeded from Historical Evidence
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.monitoring_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id TEXT NOT NULL DEFAULT 'default_teacher',
  course_id TEXT NOT NULL DEFAULT 'default_course',
  candidate_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed')),
  origin_type TEXT NOT NULL DEFAULT 'historical_evidence'
    CHECK (origin_type IN ('historical_evidence', 'manual_creation')),
  origin_session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  origin_question_id UUID REFERENCES public.session_questions(question_id) ON DELETE SET NULL,
  evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_goals_teacher ON public.monitoring_goals(teacher_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_goals_status ON public.monitoring_goals(status);
CREATE INDEX IF NOT EXISTS idx_monitoring_goals_candidate_key ON public.monitoring_goals(candidate_key);

COMMIT;
