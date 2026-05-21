CREATE TABLE IF NOT EXISTS misconception_memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  misconception_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id, attempt_type, cluster_id, misconception_key)
);

CREATE INDEX IF NOT EXISTS idx_misconception_memory_events_concept
ON misconception_memory_events(concept, misconception_key);

CREATE INDEX IF NOT EXISTS idx_misconception_memory_events_session
ON misconception_memory_events(session_id);

CREATE TABLE IF NOT EXISTS student_misconception_memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  question_id UUID NOT NULL REFERENCES session_questions(question_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('initial', 'revision')),
  cluster_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  misconception_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, participant_id, question_id, attempt_type, misconception_key)
);

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'student_misconception_memory_events'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) LIKE '%cluster_id%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE student_misconception_memory_events DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_student_misconception_memory_events_scope
ON student_misconception_memory_events(session_id, participant_id, question_id, attempt_type, misconception_key);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_events_participant
ON student_misconception_memory_events(participant_id);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_events_concept
ON student_misconception_memory_events(participant_id, concept, misconception_key);

CREATE INDEX IF NOT EXISTS idx_student_misconception_memory_events_session
ON student_misconception_memory_events(session_id);