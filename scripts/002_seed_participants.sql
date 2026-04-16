-- p001-p100 = baseline
-- p101-p200 = treatment
--
-- For development/demo: password is set to the participant_id (unique per participant).
-- Replace this seeding approach for production if you distribute real passwords.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

INSERT INTO participants (participant_id, group_name, password_hash, hash_algo, is_active)
SELECT
  'p' || LPAD(gs::TEXT, 3, '0') AS participant_id,
  CASE WHEN gs <= 100 THEN 'baseline' ELSE 'treatment' END AS group_name,
  crypt('p' || LPAD(gs::TEXT, 3, '0'), gen_salt('bf')) AS password_hash,
  'bcrypt' AS hash_algo,
  TRUE AS is_active
FROM generate_series(1, 200) AS gs
ON CONFLICT (participant_id) DO NOTHING;
