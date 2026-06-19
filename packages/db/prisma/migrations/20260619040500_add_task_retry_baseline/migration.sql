-- Add task-level retry baseline for manual retry release without mutating historical runs.
ALTER TABLE "tasks" ADD COLUMN "retry_after_attempt" INTEGER NOT NULL DEFAULT 0;
