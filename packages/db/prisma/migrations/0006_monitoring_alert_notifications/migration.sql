CREATE TABLE IF NOT EXISTS "monitoring_alert_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fingerprint" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "webhook_url" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'generic',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "monitoring_alert_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "monitoring_alert_notifications_fingerprint_webhook_url_key"
ON "monitoring_alert_notifications" ("fingerprint", "webhook_url");

CREATE INDEX IF NOT EXISTS "monitoring_alert_notifications_status_next_attempt_at_idx"
ON "monitoring_alert_notifications" ("status", "next_attempt_at");
