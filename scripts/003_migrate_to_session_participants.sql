-- Migration: participant-code join -> session-code join
-- Target schema:
--   session_participants(session_participant_id, session_id, student_name, student_id, anonymized_label, joined_at)
--   responses(response_id, session_participant_id, session_id, question_type, round_number, answer, confidence, explanation, created_at, ...)
--
-- This script is written to migrate from the *legacy* schema used by this repo previously:
--   session_participants(session_id, participant_code, display_name, joined_at) PK(session_id, participant_code)
--   responses(id, participant_code, session_id, ...)
--
-- Run in Supabase SQL editor (or psql) as an admin role.

BEGIN;

-- Ensure UUID generator is available.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Detect legacy session_participants and preserve it.
DO $$
BEGIN
  IF to_regclass('public.session_participants') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'session_participants'
         AND column_name = 'participant_code'
     )
     AND to_regclass('public.session_participants_legacy') IS NULL THEN
    EXECUTE 'ALTER TABLE public.session_participants RENAME TO session_participants_legacy';
  END IF;
END $$;

-- 2) Ensure new session_participants table exists.
CREATE TABLE IF NOT EXISTS public.session_participants (
  session_participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  student_name TEXT,
  student_id TEXT,
  anonymized_label TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, anonymized_label)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_student_id
ON public.session_participants(session_id, student_id)
WHERE student_id IS NOT NULL AND student_id <> '';

CREATE INDEX IF NOT EXISTS idx_session_participants_session
ON public.session_participants(session_id);

-- 3) Backfill new session_participants from legacy (if present) and build mapping table.
--    This mapping is used to backfill responses.session_participant_id.
CREATE TEMP TABLE IF NOT EXISTS session_participant_map (
  session_id UUID NOT NULL,
  participant_code TEXT NOT NULL,
  session_participant_id UUID NOT NULL,
  PRIMARY KEY (session_id, participant_code)
);

DO $$
BEGIN
  IF to_regclass('public.session_participants_legacy') IS NOT NULL THEN
    -- Insert/update rows and capture mapping via deterministic label allocation:
    -- label is based on legacy join order within a session.
    IF to_regclass('public.participants') IS NOT NULL THEN
      EXECUTE '
        WITH ranked AS (
          SELECT
            l.session_id,
            l.participant_code,
            l.display_name,
            l.joined_at,
            p.student_name AS participant_student_name,
            p.student_id AS participant_student_id,
            row_number() OVER (
              PARTITION BY l.session_id
              ORDER BY l.joined_at ASC, l.participant_code ASC
            ) AS rn
          FROM public.session_participants_legacy l
          LEFT JOIN public.participants p
            ON p.participant_code = l.participant_code
        ),
        upserted AS (
          INSERT INTO public.session_participants (
            session_id,
            student_name,
            student_id,
            anonymized_label,
            joined_at
          )
          SELECT
            r.session_id,
            COALESCE(r.participant_student_name, r.display_name),
            r.participant_student_id,
            (''P'' || lpad(r.rn::text, 2, ''0'')) AS anonymized_label,
            r.joined_at
          FROM ranked r
          ON CONFLICT (session_id, anonymized_label) DO UPDATE
            SET student_name = EXCLUDED.student_name,
                student_id = EXCLUDED.student_id,
                joined_at = EXCLUDED.joined_at
          RETURNING session_participant_id, session_id, anonymized_label
        )
        INSERT INTO session_participant_map (session_id, participant_code, session_participant_id)
        SELECT
          r.session_id,
          r.participant_code,
          u.session_participant_id
        FROM ranked r
        JOIN upserted u
          ON u.session_id = r.session_id
         AND u.anonymized_label = (''P'' || lpad(r.rn::text, 2, ''0''))
        ON CONFLICT (session_id, participant_code) DO UPDATE
          SET session_participant_id = EXCLUDED.session_participant_id
      ';
    ELSE
      EXECUTE '
        WITH ranked AS (
          SELECT
            l.session_id,
            l.participant_code,
            l.display_name,
            l.joined_at,
            row_number() OVER (
              PARTITION BY l.session_id
              ORDER BY l.joined_at ASC, l.participant_code ASC
            ) AS rn
          FROM public.session_participants_legacy l
        ),
        upserted AS (
          INSERT INTO public.session_participants (
            session_id,
            student_name,
            student_id,
            anonymized_label,
            joined_at
          )
          SELECT
            r.session_id,
            r.display_name,
            NULL,
            (''P'' || lpad(r.rn::text, 2, ''0'')) AS anonymized_label,
            r.joined_at
          FROM ranked r
          ON CONFLICT (session_id, anonymized_label) DO UPDATE
            SET student_name = EXCLUDED.student_name,
                joined_at = EXCLUDED.joined_at
          RETURNING session_participant_id, session_id, anonymized_label
        )
        INSERT INTO session_participant_map (session_id, participant_code, session_participant_id)
        SELECT
          r.session_id,
          r.participant_code,
          u.session_participant_id
        FROM ranked r
        JOIN upserted u
          ON u.session_id = r.session_id
         AND u.anonymized_label = (''P'' || lpad(r.rn::text, 2, ''0''))
        ON CONFLICT (session_id, participant_code) DO UPDATE
          SET session_participant_id = EXCLUDED.session_participant_id
      ';
    END IF;
  END IF;
END $$;

-- 4) Migrate responses to reference session_participants.
-- 4a) Rename primary key column to response_id (id -> response_id) if needed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'responses' AND column_name = 'id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'responses' AND column_name = 'response_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.responses RENAME COLUMN id TO response_id';
  END IF;
END $$;

-- 4b) Add session_participant_id column if missing.
ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS session_participant_id UUID;

-- 4c) Backfill from mapping (legacy participant_code -> new session_participant_id).
UPDATE public.responses r
SET session_participant_id = m.session_participant_id
FROM session_participant_map m
WHERE r.session_id = m.session_id
  AND r.participant_code = m.participant_code
  AND r.session_participant_id IS NULL;

-- 4d) Add uniqueness for the new identity (keeps legacy unique constraint if present).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_responses_session_participant_round
ON public.responses(session_participant_id, session_id, question_type, round_number);

CREATE INDEX IF NOT EXISTS idx_responses_session_participant
ON public.responses(session_participant_id);

-- 4e) Ensure there are no orphaned non-null references before adding FK.
UPDATE public.responses r
SET session_participant_id = NULL
WHERE r.session_participant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.session_participants sp
    WHERE sp.session_participant_id = r.session_participant_id
  );

-- 4f) Add FK used by PostgREST embedding.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'responses_session_participant_id_fkey'
  ) THEN
    EXECUTE '
      ALTER TABLE public.responses
      ADD CONSTRAINT responses_session_participant_id_fkey
      FOREIGN KEY (session_participant_id)
      REFERENCES public.session_participants(session_participant_id)
      ON DELETE CASCADE
    ';
  END IF;
END $$;

COMMIT;

-- Optional: ask PostgREST (Supabase API) to reload schema cache.
-- If you still see PGRST200 after running this migration, run:
--   SELECT pg_notify('pgrst', 'reload schema');
