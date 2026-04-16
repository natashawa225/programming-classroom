-- Phase 1: Create all required tables

-- Participants (pre-seeded p001-p200 with unique passwords)
CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT UNIQUE NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('baseline', 'treatment')),
  password_hash TEXT NOT NULL,
  hash_algo TEXT NOT NULL DEFAULT 'bcrypt',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions (teacher-created classroom sessions)
CREATE TABLE IF NOT EXISTS sessions (
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session questions (3–5 open-ended prompts)
CREATE TABLE IF NOT EXISTS session_questions (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  position INT NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT,
  timer_seconds INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_session_questions_session
ON session_questions(session_id, position);

-- Session-level participants (created when a student joins a session)
-- NOTE: Do not expose student_name/student_id on shared dashboards; use anonymized_label.
CREATE TABLE IF NOT EXISTS session_participants (
  session_participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id TEXT REFERENCES participants(participant_id),
  student_name TEXT,
  student_id TEXT,
  anonymized_label TEXT NOT NULL,
  join_token_hash TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, anonymized_label),
  UNIQUE(session_id, participant_id)
);

-- Prevent duplicate joins per participant_id
CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_participant_id
ON session_participants(session_id, participant_id)
WHERE participant_id IS NOT NULL AND participant_id <> '';

-- Join token is session-scoped (cookie name includes session_id)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_join_token_hash
ON session_participants(session_id, join_token_hash)
WHERE join_token_hash IS NOT NULL AND join_token_hash <> '';

-- Student responses (supports multiple rounds)
CREATE TABLE IF NOT EXISTS responses (
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_participant_id UUID REFERENCES session_participants(session_participant_id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES session_questions(question_id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('main', 'revision', 'transfer')),
  round_number INT NOT NULL DEFAULT 1,
  answer TEXT NOT NULL,
  confidence INT NOT NULL CHECK (confidence BETWEEN 1 AND 5),
  explanation TEXT,
  is_correct BOOLEAN,
  time_taken_seconds INT,
  original_response_id UUID REFERENCES responses(response_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, session_participant_id, question_id, round_number)
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
