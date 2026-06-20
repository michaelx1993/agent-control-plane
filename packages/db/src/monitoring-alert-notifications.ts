import type { DatabaseClient } from "./client.js";

export interface RecordMonitoringAlertNotificationFailureInput {
  fingerprint: string;
  level: string;
  webhookUrl: string;
  format: string;
  payload: unknown;
  reason: string;
  nextAttemptAt: Date;
}

export interface DueMonitoringAlertNotification {
  id: string;
  fingerprint: string;
  webhookUrl: string;
  format: string;
  payload: unknown;
  attempts: number;
}

interface DueMonitoringAlertNotificationRow {
  id: string;
  fingerprint: string;
  webhook_url: string;
  format: string;
  payload: unknown;
  attempts: number;
}

export async function recordMonitoringAlertNotificationFailure(
  client: DatabaseClient,
  input: RecordMonitoringAlertNotificationFailureInput,
): Promise<void> {
  await client.query(
    `
      insert into monitoring_alert_notifications (
        id,
        fingerprint,
        level,
        status,
        webhook_url,
        format,
        payload,
        last_error,
        next_attempt_at,
        created_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        $1,
        $2,
        'pending',
        $3,
        $4,
        $5::jsonb,
        $6,
        $7,
        now(),
        now()
      )
      on conflict (fingerprint, webhook_url) do update set
        level = excluded.level,
        status = 'pending',
        format = excluded.format,
        payload = excluded.payload,
        last_error = excluded.last_error,
        next_attempt_at = excluded.next_attempt_at,
        updated_at = now()
    `,
    [
      input.fingerprint,
      input.level,
      input.webhookUrl,
      input.format,
      JSON.stringify(input.payload),
      input.reason,
      input.nextAttemptAt,
    ],
  );
}

export async function listDueMonitoringAlertNotifications(
  client: DatabaseClient,
  options: { limit: number; now?: Date },
): Promise<DueMonitoringAlertNotification[]> {
  const result = await client.query<DueMonitoringAlertNotificationRow>(
    `
      select
        id,
        fingerprint,
        webhook_url,
        format,
        payload,
        attempts
      from monitoring_alert_notifications
      where status in ('pending', 'failed')
        and next_attempt_at <= $1
      order by next_attempt_at asc, created_at asc
      limit $2
    `,
    [options.now ?? new Date(), options.limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    fingerprint: row.fingerprint,
    webhookUrl: row.webhook_url,
    format: row.format,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function markMonitoringAlertNotificationSent(
  client: DatabaseClient,
  id: string,
): Promise<void> {
  await client.query(
    `
      update monitoring_alert_notifications
      set
        status = 'sent',
        sent_at = now(),
        updated_at = now()
      where id = $1
    `,
    [id],
  );
}

export async function markMonitoringAlertNotificationFailed(
  client: DatabaseClient,
  input: { id: string; reason: string; nextAttemptAt: Date },
): Promise<void> {
  await client.query(
    `
      update monitoring_alert_notifications
      set
        status = 'failed',
        attempts = attempts + 1,
        last_error = $2,
        next_attempt_at = $3,
        updated_at = now()
      where id = $1
    `,
    [input.id, input.reason, input.nextAttemptAt],
  );
}
