-- Student cluster-mediated summaries.
-- These tables support a cluster-then-feedback flow:
-- response -> cluster membership -> cached cluster feedback -> per-student summary snapshot.

CREATE TABLE IF NOT EXISTS student_cluster_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES session_questions(question_id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  response_id UUID REFERENCES responses(response_id) ON DELETE SET NULL,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  cluster_label TEXT,
  conceptual_alignment NUMERIC,
  understanding_bucket TEXT,
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id, participant_id, attempt_type)
);

CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_session_participant
ON student_cluster_memberships(session_id, participant_id);

CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_session_question
ON student_cluster_memberships(session_id, question_id);

CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_cluster
ON student_cluster_memberships(session_id, question_id, attempt_type, cluster_id);

CREATE INDEX IF NOT EXISTS idx_student_cluster_memberships_response
ON student_cluster_memberships(response_id);

CREATE TABLE IF NOT EXISTS cluster_feedback_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  cluster_label TEXT,
  student_title TEXT,
  what_you_understood TEXT,
  likely_gap TEXT,
  micro_hint TEXT,
  try_again_prompt TEXT,
  counterexample TEXT,
  teacher_note TEXT,
  safety_notes TEXT,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id, attempt_type, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_feedback_cards_session_question
ON cluster_feedback_cards(session_id, question_id);

CREATE INDEX IF NOT EXISTS idx_cluster_feedback_cards_attempt
ON cluster_feedback_cards(session_id, question_id, attempt_type);

CREATE TABLE IF NOT EXISTS student_summary_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  summary_json JSONB NOT NULL,
  generated_from_hash TEXT NOT NULL,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, participant_id)
);

CREATE TABLE IF NOT EXISTS misconception_memory (
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
