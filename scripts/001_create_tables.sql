-- SMART-Draft: Classroom Response System Database Schema
-- Phase 1: Create all required tables

-- Sessions (teacher-created classroom sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_code TEXT UNIQUE NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('baseline', 'treatment')),
  question TEXT NOT NULL,
  answer_options JSONB NOT NULL, -- ["A", "B", "C", "D"] or custom options
  correct_answer TEXT NOT NULL,
  transfer_question TEXT,
  transfer_options JSONB,
  transfer_correct_answer TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'revision', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session-level participants (created when a student joins a session)
-- NOTE: Do not expose student_name/student_id on shared dashboards; use anonymized_label.
CREATE TABLE IF NOT EXISTS session_participants (
  session_participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  student_name TEXT,
  student_id TEXT,
  anonymized_label TEXT NOT NULL,
  join_token_hash TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, anonymized_label)
);

ALTER TABLE session_participants
ADD COLUMN IF NOT EXISTS join_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_join_token_hash
ON session_participants(join_token_hash)
WHERE join_token_hash IS NOT NULL AND join_token_hash <> '';

-- Token lookup (cookie token is hashed server-side before querying)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_join_token_hash
ON session_participants(join_token_hash)
WHERE join_token_hash IS NOT NULL AND join_token_hash <> '';

-- Student responses (supports multiple rounds)
CREATE TABLE IF NOT EXISTS responses (
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_participant_id UUID REFERENCES session_participants(session_participant_id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('main', 'revision', 'transfer')),
  round_number INT NOT NULL DEFAULT 1,
  answer TEXT NOT NULL,
  confidence INT NOT NULL CHECK (confidence BETWEEN 1 AND 5),
  explanation TEXT,
  is_correct BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_participant_id, session_id, question_type, round_number)
);

-- AI-generated outputs
CREATE TABLE IF NOT EXISTS ai_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  condition TEXT NOT NULL,
  teacher_summary JSONB, -- misconception cards, suggestions (treatment)
  student_summary JSONB, -- direct feedback or class summary
  raw_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teacher action log (for research analysis)
CREATE TABLE IF NOT EXISTS teacher_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
CREATE INDEX IF NOT EXISTS idx_responses_participant ON responses(session_participant_id);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_session ON ai_outputs(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(session_code);
CREATE INDEX IF NOT EXISTS idx_teacher_actions_session ON teacher_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_session ON session_participants(session_id);
