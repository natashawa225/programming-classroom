-- Migration: 022_add_bounded_agency_memory_tables.sql
-- Supports Non-Diagnostic Bounded Artificial Agency in MeshQuiz
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Session memory bridge (Stores session-level reasoning pattern profile and next-session watchlist)
CREATE TABLE IF NOT EXISTS public.session_memory (
  memory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id TEXT NOT NULL DEFAULT 'default_course',
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  summary_narrative TEXT NOT NULL,
  watchlist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id)
);

-- 2. Longitudinal reasoning pattern tracking across sessions
CREATE TABLE IF NOT EXISTS public.pattern_history (
  pattern_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID REFERENCES public.session_memory(memory_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  pattern_key TEXT NOT NULL,
  pattern_label TEXT NOT NULL,
  pattern_description TEXT NOT NULL,
  prevalence_percentage NUMERIC NOT NULL,
  response_count INT NOT NULL DEFAULT 0,
  average_confidence NUMERIC,
  representative_response_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
  longitudinal_status TEXT NOT NULL DEFAULT 'observed'
    CHECK (longitudinal_status IN ('observed', 'reappeared', 'changed_prevalence', 'not_observed')),
  first_observed_session_id UUID REFERENCES public.sessions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Lecturer annotations & interpretations (Separates AI observation from Human Interpretation/Decision)
CREATE TABLE IF NOT EXISTS public.lecturer_annotations (
  annotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'inspected',
      'selected_for_discussion',
      'pinned',
      'dismissed',
      'renamed',
      'annotated',
      'monitored'
    )
  ),
  lecturer_interpretation TEXT,
  lecturer_decision TEXT,
  custom_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Bounded Agent Actions & Research Audit Log
CREATE TABLE IF NOT EXISTS public.agent_actions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL DEFAULT 'classroom_reasoning_observer',
  trigger_type TEXT NOT NULL, -- e.g., 'stream_threshold', 'longitudinal_match', 'session_close'
  observation_data JSONB NOT NULL,
  decision_rule_executed TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  human_checkpoint_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (human_checkpoint_status IN ('pending', 'accepted', 'dismissed', 'overridden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_memory_session ON public.session_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_pattern_history_session ON public.pattern_history(session_id);
CREATE INDEX IF NOT EXISTS idx_pattern_history_key ON public.pattern_history(pattern_key);
CREATE INDEX IF NOT EXISTS idx_lecturer_annotations_session ON public.lecturer_annotations(session_id);
CREATE INDEX IF NOT EXISTS idx_lecturer_annotations_question ON public.lecturer_annotations(question_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_session ON public.agent_actions(session_id);

COMMIT;
