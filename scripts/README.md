# Scripts

This folder contains SQL migration/seed scripts for the Supabase database.

## Migration order

Run numbered SQL files in ascending order when setting up or upgrading a database:

1. `001_create_tables.sql`
2. `002_seed_participants.sql`
3. `003_migrate_to_session_participants.sql`
4. Continue through the latest numbered migration.

The numbered files are kept as deployment/history artifacts. Do not delete or reorder them unless you are intentionally creating a new consolidated schema baseline.

## Generated files

`generate-participant-seed.mjs` writes generated seed outputs to `scripts/generated/`.

That directory is ignored by git because it may contain generated participant credentials. Regenerate it when needed:

```bash
node scripts/generate-participant-seed.mjs
```

## Local clutter

macOS `.DS_Store` files should not be committed.
