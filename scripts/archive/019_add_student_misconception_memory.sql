CREATE TABLE IF NOT EXISTS student_misconception_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT NOT NULL REFERENCES participants(participant_id),
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

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_participant
ON student_misconception_memory(participant_id);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_participant_concept
ON student_misconception_memory(participant_id, concept);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_status
ON student_misconception_memory(status);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_last_seen
ON student_misconception_memory(last_seen_at);

ALTER TABLE student_cluster_memberships
  ADD COLUMN IF NOT EXISTS understanding_bucket TEXT,
  ADD COLUMN IF NOT EXISTS conceptual_alignment NUMERIC;

ALTER TABLE cluster_feedback_cards
  ADD COLUMN IF NOT EXISTS reasoning_pattern TEXT,
  ADD COLUMN IF NOT EXISTS confidence_check TEXT,
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fallback_reason TEXT;
