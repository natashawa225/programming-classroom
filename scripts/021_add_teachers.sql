-- Multiple teacher accounts.
--
-- Purely additive: creates a new `teachers` table and adds a nullable
-- `teacher_id` column to `sessions`. No existing columns are altered or
-- dropped, so this is safe to run against a database with existing data.

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON sessions(teacher_id);
