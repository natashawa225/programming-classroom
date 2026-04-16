BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Sessions status: map old values first, then apply new constraint
DO $$
DECLARE
  stmt TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sessions'
      AND column_name = 'status'
  ) THEN
    -- Drop old CHECK constraints on sessions.status
    SELECT string_agg(
      'ALTER TABLE public.sessions DROP CONSTRAINT ' || quote_ident(c.conname) || ';',
      ' '
    )
    INTO stmt
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attnum = ANY (c.conkey)
     AND a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.sessions'::regclass
      AND c.contype = 'c'
      AND a.attname = 'status';

    IF stmt IS NOT NULL THEN
      EXECUTE stmt;
    END IF;

    -- Map old statuses to new ones BEFORE re-adding constraint
    UPDATE public.sessions
    SET status = CASE status
      WHEN 'waiting' THEN 'draft'
      WHEN 'active' THEN 'live'
      WHEN 'transfer' THEN 'live'
      WHEN 'complete' THEN 'closed'
      ELSE status
    END
    WHERE status IN ('waiting', 'active', 'transfer', 'complete');

    -- Optional safety: normalize NULL/empty/unexpected values too
    UPDATE public.sessions
    SET status = 'draft'
    WHERE status IS NULL
       OR status = ''
       OR status NOT IN ('draft', 'live', 'analysis_ready', 'revision', 'closed');

    -- Set default and add new check
    EXECUTE 'ALTER TABLE public.sessions ALTER COLUMN status SET DEFAULT ''draft'';';
    EXECUTE 'ALTER TABLE public.sessions ADD CONSTRAINT sessions_status_check CHECK (status IN (''draft'',''live'',''analysis_ready'',''revision'',''closed''));';
  END IF;
END $$;

-- 2) session_participants join token hash
ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS join_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_participants_session_join_token_hash
ON public.session_participants(session_id, join_token_hash)
WHERE join_token_hash IS NOT NULL AND join_token_hash <> '';

-- 3) responses: revision question_type + unique constraint for dedupe
DO $$
DECLARE
  stmt TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'responses'
      AND column_name = 'question_type'
  ) THEN
    -- Drop old CHECK constraints on responses.question_type
    SELECT string_agg(
      'ALTER TABLE public.responses DROP CONSTRAINT ' || quote_ident(c.conname) || ';',
      ' '
    )
    INTO stmt
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attnum = ANY (c.conkey)
     AND a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.responses'::regclass
      AND c.contype = 'c'
      AND a.attname = 'question_type';

    IF stmt IS NOT NULL THEN
      EXECUTE stmt;
    END IF;

    -- Optional cleanup in case old data has unexpected values
    UPDATE public.responses
    SET question_type = 'main'
    WHERE question_type IS NULL
       OR question_type = ''
       OR question_type NOT IN ('main', 'revision', 'transfer');

    EXECUTE 'ALTER TABLE public.responses ADD CONSTRAINT responses_question_type_check CHECK (question_type IN (''main'',''revision'',''transfer''));';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_responses_session_participant_round
ON public.responses(session_participant_id, session_id, question_type, round_number);

COMMIT;
