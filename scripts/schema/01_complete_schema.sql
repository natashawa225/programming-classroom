-- ============================================================================
-- Complete Production Database Schema for MeshQuiz / Programming Classroom
-- Reconstructed final state after migrations 001-024
-- ============================================================================

BEGIN;

-- Enable pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Teachers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. Participants (Students)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT UNIQUE NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('baseline', 'treatment')),
  password_hash TEXT NOT NULL,
  hash_algo TEXT NOT NULL DEFAULT 'bcrypt',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. Sessions (Classroom Sessions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_code TEXT UNIQUE NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('baseline', 'treatment')),
  title TEXT,
  question TEXT NOT NULL,
  answer_options JSONB NOT NULL,
  correct_answer TEXT NOT NULL,
  transfer_question TEXT,
  transfer_options JSONB,
  transfer_correct_answer TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'analysis_ready', 'revision', 'closed')),
  live_phase TEXT NOT NULL DEFAULT 'not_started' CHECK (
    live_phase IN (
      'not_started',
      'question_initial_open',
      'question_initial_closed',
      'question_revision_open',
      'question_revision_closed',
      'session_completed'
    )
  ),
  current_question_position INT NOT NULL DEFAULT 1,
  current_timer_seconds INT,
  timer_started_at TIMESTAMPTZ,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_code ON public.sessions(session_code);
CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON public.sessions(teacher_id);

-- ----------------------------------------------------------------------------
-- 4. Session Questions (Open-ended Prompts per Session)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_questions (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  position INT NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT,
  timer_seconds INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_session_questions_session ON public.session_questions(session_id, position);

-- ----------------------------------------------------------------------------
-- 5. Question Reference Answers (Multiple Reference Reasoning Examples)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_reference_answers (
  reference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  position INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(question_id, position)
);

CREATE INDEX IF NOT EXISTS idx_question_reference_answers_question ON public.question_reference_answers(question_id, position);

-- ----------------------------------------------------------------------------
-- 6. Session Participants (Student Session Roster & Join Tokens)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_participants (
  session_participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_id TEXT REFERENCES public.participants(participant_id),
  student_name TEXT,
  student_id TEXT,
  anonymized_label TEXT NOT NULL,
  join_token_hash TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, anonymized_label),
  UNIQUE(session_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_session_participants_session ON public.session_participants(session_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_participant_id
ON public.session_participants(session_id, participant_id)
WHERE participant_id IS NOT NULL AND participant_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_join_token_hash
ON public.session_participants(session_id, join_token_hash)
WHERE join_token_hash IS NOT NULL AND join_token_hash <> '';

-- ----------------------------------------------------------------------------
-- 7. Responses (Student Answers & Confidence Ratings)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.responses (
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_participant_id UUID REFERENCES public.session_participants(session_participant_id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('main', 'revision', 'transfer')),
  attempt_type TEXT NOT NULL DEFAULT 'initial' CHECK (attempt_type IN ('initial', 'revision')),
  round_number INT NOT NULL DEFAULT 1,
  answer TEXT NOT NULL,
  confidence INT NOT NULL CHECK (confidence BETWEEN 1 AND 5),
  explanation TEXT,
  is_correct BOOLEAN,
  time_taken_seconds INT,
  original_response_id UUID REFERENCES public.responses(response_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, session_participant_id, question_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_responses_session ON public.responses(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_participant ON public.responses(session_participant_id);
CREATE INDEX IF NOT EXISTS idx_responses_session_question_attempt ON public.responses(session_id, question_id, attempt_type);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_responses_session_participant_round
ON public.responses(session_participant_id, session_id, question_type, round_number);

-- ----------------------------------------------------------------------------
-- 8. Live Question Analyses (Cached Cluster Analyses for Live Classroom)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_question_analyses (
  live_question_analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  analysis_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id, attempt_type)
);

CREATE INDEX IF NOT EXISTS idx_live_question_analyses_session ON public.live_question_analyses(session_id, generated_at DESC);

-- ----------------------------------------------------------------------------
-- 9. Analysis Runs & AI Labels (Detailed AI Execution Audit Trail)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analysis_runs (
  analysis_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number IN (1, 2)),
  model TEXT,
  model_name TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  error_message TEXT,
  prompt_json JSONB,
  raw_response_json JSONB,
  analysis_json JSONB,
  summary_json JSONB,
  condition TEXT CHECK (condition IN ('baseline', 'treatment')),
  session_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, round_number, created_at)
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_session_round ON public.analysis_runs(session_id, round_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_session_question_round ON public.analysis_runs(session_id, question_id, round_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_condition ON public.analysis_runs(condition);

CREATE TABLE IF NOT EXISTS public.response_ai_labels (
  response_ai_label_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id UUID REFERENCES public.analysis_runs(analysis_run_id) ON DELETE CASCADE,
  response_id UUID REFERENCES public.responses(response_id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number IN (1, 2)),
  understanding_level TEXT CHECK (understanding_level IN ('correct', 'mostly_correct', 'partially_correct', 'incorrect', 'unclear')),
  evaluation_category TEXT CHECK (evaluation_category IN ('fully_correct', 'partially_correct', 'relevant_incomplete', 'misconception', 'unclear')),
  is_correct BOOLEAN,
  misconception_label TEXT,
  cluster_id TEXT,
  reasoning_summary TEXT,
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(analysis_run_id, response_id)
);

CREATE INDEX IF NOT EXISTS idx_response_ai_labels_session_round ON public.response_ai_labels(session_id, round_number);
CREATE INDEX IF NOT EXISTS idx_response_ai_labels_question_round ON public.response_ai_labels(question_id, round_number);

-- ----------------------------------------------------------------------------
-- 10. Session Events Log
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON public.session_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_events_session_question ON public.session_events(session_id, question_id, round_number, created_at DESC);

-- ----------------------------------------------------------------------------
-- 11. Teacher Actions Log (Research Audit Trail)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_actions_session ON public.teacher_actions(session_id);

-- ----------------------------------------------------------------------------
-- 12. Session Summaries & Student Session Summaries
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  summary_json JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('openai', 'fallback')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON public.session_summaries(session_id);

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

CREATE INDEX IF NOT EXISTS idx_student_session_summaries_session_participant_id ON public.student_session_summaries(session_participant_id);

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

-- ----------------------------------------------------------------------------
-- 13. Student Cluster Memberships & Feedback Cards
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_cluster_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES public.participants(participant_id),
  response_id UUID REFERENCES public.responses(response_id) ON DELETE SET NULL,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  cluster_label TEXT,
  conceptual_alignment NUMERIC,
  understanding_bucket TEXT,
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id, participant_id, attempt_type)
);

CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_session_participant ON public.student_cluster_memberships(session_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_session_question ON public.student_cluster_memberships(session_id, question_id);
CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_cluster ON public.student_cluster_memberships(session_id, question_id, attempt_type, cluster_id);
CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_response ON public.student_cluster_memberships(response_id);

CREATE TABLE IF NOT EXISTS public.cluster_feedback_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  cluster_label TEXT,
  student_title TEXT,
  reasoning_pattern TEXT,
  what_you_understood TEXT,
  likely_gap TEXT,
  micro_hint TEXT,
  try_again_prompt TEXT,
  counterexample TEXT,
  confidence_check TEXT,
  teacher_note TEXT,
  safety_notes TEXT,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id, attempt_type, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_feedback_cards_session_question ON public.cluster_feedback_cards(session_id, question_id);
CREATE INDEX IF NOT EXISTS idx_cluster_feedback_cards_attempt ON public.cluster_feedback_cards(session_id, question_id, attempt_type);

CREATE TABLE IF NOT EXISTS public.student_summary_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES public.participants(participant_id),
  summary_json JSONB NOT NULL,
  generated_from_hash TEXT NOT NULL,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, participant_id)
);

-- ----------------------------------------------------------------------------
-- 14. Misconception Memory & Longitudinal Memory Events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.misconception_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept TEXT NOT NULL,
  misconception_key TEXT NOT NULL,
  description TEXT,
  common_patterns JSONB,
  repair_strategies JSONB,
  evidence_count INT DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(concept, misconception_key)
);

CREATE TABLE IF NOT EXISTS public.student_misconception_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT NOT NULL REFERENCES public.participants(participant_id),
  concept TEXT NOT NULL,
  misconception_key TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_count INT NOT NULL DEFAULT 1,
  resolved_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(participant_id, concept, misconception_key)
);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_participant ON public.student_misconception_memory(participant_id);
CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_participant_concept ON public.student_misconception_memory(participant_id, concept);
CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_status ON public.student_misconception_memory(status);
CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_last_seen ON public.student_misconception_memory(last_seen_at);

CREATE TABLE IF NOT EXISTS public.misconception_memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  misconception_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id, attempt_type, cluster_id, misconception_key)
);

CREATE INDEX IF NOT EXISTS idx_misconception_memory_events_concept ON public.misconception_memory_events(concept, misconception_key);
CREATE INDEX IF NOT EXISTS idx_misconception_memory_events_session ON public.misconception_memory_events(session_id);

CREATE TABLE IF NOT EXISTS public.student_misconception_memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES public.participants(participant_id),
  question_id UUID NOT NULL REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  misconception_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_student_misconception_memory_events_scope
ON public.student_misconception_memory_events(session_id, participant_id, question_id, attempt_type, misconception_key);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_events_participant ON public.student_misconception_memory_events(participant_id);
CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_events_concept ON public.student_misconception_memory_events(participant_id, concept, misconception_key);
CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_events_session ON public.student_misconception_memory_events(session_id);

-- ----------------------------------------------------------------------------
-- 15. Bounded Agency Memory & Audit Tables (MeshQuiz Agency Layer)
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_session_memory_session ON public.session_memory(session_id);

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

CREATE INDEX IF NOT EXISTS idx_pattern_history_session ON public.pattern_history(session_id);
CREATE INDEX IF NOT EXISTS idx_pattern_history_key ON public.pattern_history(pattern_key);

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

CREATE INDEX IF NOT EXISTS idx_lecturer_annotations_session ON public.lecturer_annotations(session_id);
CREATE INDEX IF NOT EXISTS idx_lecturer_annotations_question ON public.lecturer_annotations(question_id);

CREATE TABLE IF NOT EXISTS public.agent_actions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.session_questions(question_id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL DEFAULT 'classroom_reasoning_observer',
  trigger_type TEXT NOT NULL,
  observation_data JSONB NOT NULL,
  decision_rule_executed TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  human_checkpoint_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (human_checkpoint_status IN ('pending', 'accepted', 'dismissed', 'overridden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_session ON public.agent_actions(session_id);

-- ----------------------------------------------------------------------------
-- 16. Monitoring Goals (Persistent Teacher-Authored Goals)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 17. Enable Supabase Realtime Publications
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_participants;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.responses;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_question_analyses;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
