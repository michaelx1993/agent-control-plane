-- CreateTable
CREATE TABLE "worker_api_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "worker_id" TEXT NOT NULL,
    "run_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_api_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_api_requests_worker_id_idempotency_key_key" ON "worker_api_requests"("worker_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "worker_api_requests_run_id_created_at_idx" ON "worker_api_requests"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "worker_api_requests_operation_created_at_idx" ON "worker_api_requests"("operation", "created_at");

-- AddForeignKey
ALTER TABLE "worker_api_requests" ADD CONSTRAINT "worker_api_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
