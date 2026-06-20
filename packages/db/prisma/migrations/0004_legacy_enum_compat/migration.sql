-- Older local databases created before the text-state schema used PostgreSQL enums.
-- Keep this migration conditional so current text-based schemas are unaffected.
DO $$
BEGIN
  IF to_regtype('"TaskState"') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = to_regtype('"TaskState"')
        AND enumlabel = 'Duplicate'
    )
  THEN
    ALTER TYPE "TaskState" ADD VALUE 'Duplicate';
  END IF;

  IF to_regtype('"RunStatus"') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = to_regtype('"RunStatus"')
        AND enumlabel = 'stalled'
    )
  THEN
    ALTER TYPE "RunStatus" ADD VALUE 'stalled';
  END IF;
END $$;
