ALTER TABLE "prompt_bindings"
ALTER COLUMN "status" SET DEFAULT 'pending';

INSERT INTO users (
  id,
  external_provider,
  external_user_id,
  name,
  email,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000901',
  'local',
  'local-operator',
  'local-operator',
  null,
  now(),
  now()
)
ON CONFLICT (external_provider, external_user_id) DO UPDATE SET
  name = excluded.name,
  updated_at = now();
