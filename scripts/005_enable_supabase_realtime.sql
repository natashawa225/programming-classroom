-- Enable Supabase Realtime for classroom tables.
-- Run in Supabase SQL editor (requires privileges).
--
-- Realtime for Postgres Changes uses the `supabase_realtime` publication.
-- If tables are not in the publication, client subscriptions will connect but never receive events.

BEGIN;

-- Ensure publication exists (Supabase creates this, but this is safe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'CREATE PUBLICATION supabase_realtime;';
  END IF;
END $$;

-- Add tables (idempotent: will error if already present in some setups, so use IF NOT EXISTS style via exception).
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.session_participants;';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.responses;';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

COMMIT;

-- After running, if you still don't receive events:
-- 1) In Supabase Dashboard > Database > Replication, confirm tables are enabled.
-- 2) Ensure RLS policies (if enabled) allow the realtime user to read rows for your anon JWT.

