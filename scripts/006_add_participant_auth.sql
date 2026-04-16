-- Migration: add participant credential auth + group-lock join
-- Run in Supabase SQL editor as an admin role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Participants table (pre-seeded externally or via scripts/002_seed_participants.sql)
CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT UNIQUE NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('baseline', 'treatment')),
  password_hash TEXT NOT NULL,
  hash_algo TEXT NOT NULL DEFAULT 'bcrypt',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) session_participants: link to participant_id and enforce per-session uniqueness
ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS participant_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_participants_participant_id_fkey'
  ) THEN
    EXECUTE '
      ALTER TABLE public.session_participants
      ADD CONSTRAINT session_participants_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.participants(participant_id)
    ';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_participant_id
ON public.session_participants(session_id, participant_id)
WHERE participant_id IS NOT NULL AND participant_id <> '';

-- 3) Ensure join token hash is session-scoped (safe if already exists)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_join_token_hash
ON public.session_participants(session_id, join_token_hash)
WHERE join_token_hash IS NOT NULL AND join_token_hash <> '';

COMMIT;

