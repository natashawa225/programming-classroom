# Scripts & Database Management

This folder contains database setup scripts, consolidated schema baselines, archived migration history, and seed generator tools for Supabase.

## Database Setup

To set up a fresh Supabase database or reset your environment to the canonical final schema state:

1. Execute **`scripts/schema/01_complete_schema.sql`** in the Supabase SQL Editor. This file contains the complete, reconstructed final schema (all tables, columns, indexes, functions, triggers, and realtime publications).
2. Execute **`scripts/schema/02_initial_seeds.sql`** to load default sample experiment sessions and open-ended question prompts.

## Seed Generators (`scripts/tools/`)

Generator tools create private credential seeds in `scripts/generated/` (which is git-ignored for security):

```bash
# Generate participant seeds
node scripts/tools/generate-participant-seed.mjs

# Generate teacher seeds
node scripts/tools/generate-teacher-seed.mjs
```

Apply generated outputs from `scripts/generated/` to Supabase as an admin user.

## Migration History (`scripts/archive/`)

Incremental SQL migration files (`001_` through `024_`) are archived in `scripts/archive/` as historical records. The single source of truth for fresh database provisioning is `scripts/schema/01_complete_schema.sql`.
