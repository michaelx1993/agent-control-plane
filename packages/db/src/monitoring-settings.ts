import type { DatabaseClient } from "./client.js";

export interface MonitoringThresholds {
  queueBacklogWarning: number;
  stalledRunsCritical: number;
  retryBacklogWarning: number;
  failureRateCritical: number;
  failureRateMinFinished: number;
  costWarningUsd: number;
  retryBackoffMs: number;
}

export interface UpdateMonitoringThresholdsInput extends MonitoringThresholds {
  actorName?: string;
}

const settingKeyByField = {
  queueBacklogWarning: "monitoring.queue_backlog_warning",
  stalledRunsCritical: "monitoring.stalled_runs_critical",
  retryBacklogWarning: "monitoring.retry_backlog_warning",
  failureRateCritical: "monitoring.failure_rate_critical",
  failureRateMinFinished: "monitoring.failure_rate_min_finished",
  costWarningUsd: "monitoring.cost_warning_usd",
  retryBackoffMs: "monitoring.retry_backoff_ms",
} as const satisfies Record<keyof MonitoringThresholds, string>;

const fieldBySettingKey = Object.fromEntries(
  Object.entries(settingKeyByField).map(([field, key]) => [key, field]),
) as Record<string, keyof MonitoringThresholds>;

const settingDescriptions = {
  queueBacklogWarning: "Agent queue warning threshold.",
  stalledRunsCritical: "Stalled run critical threshold.",
  retryBacklogWarning: "Retry backlog warning threshold.",
  failureRateCritical: "24h failed / finished critical ratio.",
  failureRateMinFinished: "Minimum finished runs before failure-rate alerting.",
  costWarningUsd: "Total recorded cost warning threshold in USD.",
  retryBackoffMs: "Retry backoff window used for retry backlog calculation.",
} as const satisfies Record<keyof MonitoringThresholds, string>;

interface AppSettingRow {
  key: string;
  value: unknown;
}

export async function getMonitoringThresholds(
  client: DatabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MonitoringThresholds> {
  const thresholds = loadMonitoringThresholdsFromEnv(env);
  let rows: AppSettingRow[] = [];

  try {
    const result = await client.query<AppSettingRow>(
      `
        select key, value
        from app_settings
        where key = any($1::text[])
      `,
      [Object.values(settingKeyByField)],
    );
    rows = result.rows;
  } catch (error) {
    if (!isMissingAppSettingsTableError(error)) {
      throw error;
    }
  }

  for (const row of rows) {
    const field = fieldBySettingKey[row.key];
    if (!field) {
      continue;
    }

    thresholds[field] = normalizeThresholdValue(field, row.value, thresholds[field]);
  }

  return thresholds;
}

export async function updateMonitoringThresholds(
  client: DatabaseClient,
  input: UpdateMonitoringThresholdsInput,
): Promise<MonitoringThresholds> {
  const thresholds = normalizeMonitoringThresholds(input);

  for (const field of Object.keys(settingKeyByField) as Array<keyof MonitoringThresholds>) {
    await client.query(
      `
        insert into app_settings (key, value, description, updated_at)
        values ($1, to_jsonb($2::numeric), $3, now())
        on conflict (key) do update set
          value = excluded.value,
          description = excluded.description,
          updated_at = now()
      `,
      [settingKeyByField[field], thresholds[field], settingDescriptions[field]],
    );
  }

  await client.query(
    `
      insert into audit_events (
        id,
        action,
        entity_type,
        entity_id,
        message,
        payload,
        created_at
      )
      values (
        gen_random_uuid(),
        'monitoring_thresholds.update',
        'app_settings',
        '00000000-0000-4000-8000-000000000902',
        'Monitoring thresholds updated.',
        jsonb_build_object(
          'thresholds', $1::jsonb,
          'actor', jsonb_build_object('name', $2::text)
        ),
        now()
      )
    `,
    [JSON.stringify(thresholds), input.actorName ?? "operator"],
  );

  return thresholds;
}

export function loadMonitoringThresholdsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MonitoringThresholds {
  return {
    queueBacklogWarning: parseNonNegativeInteger(env.MONITORING_QUEUE_BACKLOG_WARNING, 20),
    stalledRunsCritical: parseNonNegativeInteger(env.MONITORING_STALLED_RUNS_CRITICAL, 0),
    retryBacklogWarning: parseNonNegativeInteger(env.MONITORING_RETRY_BACKLOG_WARNING, 0),
    failureRateCritical: parseRatio(env.MONITORING_FAILURE_RATE_CRITICAL, 0.5),
    failureRateMinFinished: parseNonNegativeInteger(env.MONITORING_FAILURE_RATE_MIN_FINISHED, 3),
    costWarningUsd: parseNonNegativeNumber(env.MONITORING_COST_WARNING_USD, 50),
    retryBackoffMs: parseNonNegativeInteger(
      env.MONITORING_RETRY_BACKOFF_MS ?? env.WORKER_RETRY_BACKOFF_MS,
      5 * 60_000,
    ),
  };
}

function normalizeMonitoringThresholds(input: MonitoringThresholds): MonitoringThresholds {
  return {
    queueBacklogWarning: Math.max(0, Math.trunc(input.queueBacklogWarning)),
    stalledRunsCritical: Math.max(0, Math.trunc(input.stalledRunsCritical)),
    retryBacklogWarning: Math.max(0, Math.trunc(input.retryBacklogWarning)),
    failureRateCritical: Math.min(1, Math.max(0, input.failureRateCritical)),
    failureRateMinFinished: Math.max(0, Math.trunc(input.failureRateMinFinished)),
    costWarningUsd: Math.max(0, input.costWarningUsd),
    retryBackoffMs: Math.max(0, Math.trunc(input.retryBackoffMs)),
  };
}

function normalizeThresholdValue(
  field: keyof MonitoringThresholds,
  value: unknown,
  fallback: number,
): number {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  if (field === "failureRateCritical") {
    return Math.min(1, Math.max(0, numberValue));
  }

  if (field === "costWarningUsd") {
    return Math.max(0, numberValue);
  }

  return Math.max(0, Math.trunc(numberValue));
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(parsed));
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, parsed);
}

function parseRatio(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsed));
}

function isMissingAppSettingsTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}
