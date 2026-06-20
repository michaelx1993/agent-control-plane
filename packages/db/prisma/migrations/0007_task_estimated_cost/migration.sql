ALTER TABLE "tasks"
ADD COLUMN IF NOT EXISTS "estimated_cost_usd" DECIMAL(12, 6);
