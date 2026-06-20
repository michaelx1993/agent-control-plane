import type { DatabaseClient } from "./client.js";

export interface DispatchPolicy {
  maxEstimatedCostUsdPerRun?: number;
  queuePriorityPolicy: QueuePriorityPolicy;
}

export type QueuePriorityPolicy =
  | "priority_first"
  | "priority_aging"
  | "repo_fair"
  | "weighted_priority"
  | "oldest_first"
  | "newest_first";

export interface UpdateDispatchPolicyInput extends Partial<DispatchPolicy> {
  actorName?: string;
}

const maxEstimatedCostSettingKey = "dispatch.max_estimated_cost_usd_per_run";
const queuePriorityPolicySettingKey = "dispatch.queue_priority_policy";

interface AppSettingRow {
  key: string;
  value: unknown;
}

export async function getDispatchPolicy(
  client: DatabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DispatchPolicy> {
  const policy = loadDispatchPolicyFromEnv(env);
  let rows: AppSettingRow[] = [];

  try {
    const result = await client.query<AppSettingRow>(
      `
        select key, value
        from app_settings
        where key = any($1::text[])
      `,
      [[maxEstimatedCostSettingKey, queuePriorityPolicySettingKey]],
    );
    rows = result.rows;
  } catch (error) {
    if (!isMissingAppSettingsTableError(error)) {
      throw error;
    }
  }

  const row = rows.find((item) => item.key === maxEstimatedCostSettingKey);
  const value = normalizeOptionalNonNegativeNumber(row?.value);
  if (value !== undefined) {
    policy.maxEstimatedCostUsdPerRun = value;
  }

  const queuePriorityPolicy = normalizeQueuePriorityPolicy(
    rows.find((item) => item.key === queuePriorityPolicySettingKey)?.value,
  );
  if (queuePriorityPolicy) {
    policy.queuePriorityPolicy = queuePriorityPolicy;
  }

  return policy;
}

export async function updateDispatchPolicy(
  client: DatabaseClient,
  input: UpdateDispatchPolicyInput,
): Promise<DispatchPolicy> {
  const policy = normalizeDispatchPolicy(input);

  await upsertOptionalNumericSetting(
    client,
    maxEstimatedCostSettingKey,
    policy.maxEstimatedCostUsdPerRun,
    "Dispatch policy: maximum estimated cost per run in USD.",
  );
  await client.query(
    `
      insert into app_settings (key, value, description, updated_at)
      values ($1, to_jsonb($2::text), $3, now())
      on conflict (key) do update set
        value = excluded.value,
        description = excluded.description,
        updated_at = now()
    `,
    [
      queuePriorityPolicySettingKey,
      policy.queuePriorityPolicy,
      "Dispatch policy: queue priority ordering.",
    ],
  );

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
        'dispatch_policy.update',
        'app_settings',
        '00000000-0000-4000-8000-000000000902',
        'Dispatch policy updated.',
        jsonb_build_object(
          'policy', $1::jsonb,
          'actor', jsonb_build_object('name', $2::text)
        ),
        now()
      )
    `,
    [JSON.stringify(policy), input.actorName ?? "operator"],
  );

  return policy;
}

export function loadDispatchPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): DispatchPolicy {
  const maxEstimatedCostUsdPerRun = normalizeOptionalNonNegativeNumber(
    env.WORKER_MAX_ESTIMATED_COST_USD_PER_RUN,
  );
  const queuePriorityPolicy =
    normalizeQueuePriorityPolicy(env.WORKER_QUEUE_PRIORITY_POLICY) ?? "priority_first";

  return {
    queuePriorityPolicy,
    ...(maxEstimatedCostUsdPerRun !== undefined ? { maxEstimatedCostUsdPerRun } : {}),
  };
}

function normalizeDispatchPolicy(input: Partial<DispatchPolicy>): DispatchPolicy {
  const maxEstimatedCostUsdPerRun = normalizeOptionalNonNegativeNumber(
    input.maxEstimatedCostUsdPerRun,
  );
  const queuePriorityPolicy = normalizeQueuePriorityPolicy(input.queuePriorityPolicy);

  return {
    queuePriorityPolicy: queuePriorityPolicy ?? "priority_first",
    ...(maxEstimatedCostUsdPerRun !== undefined ? { maxEstimatedCostUsdPerRun } : {}),
  };
}

async function upsertOptionalNumericSetting(
  client: DatabaseClient,
  key: string,
  value: number | undefined,
  description: string,
): Promise<void> {
  if (value === undefined) {
    await client.query(
      `
        delete from app_settings
        where key = $1
      `,
      [key],
    );
    return;
  }

  await client.query(
    `
      insert into app_settings (key, value, description, updated_at)
      values ($1, to_jsonb($2::numeric), $3, now())
      on conflict (key) do update set
        value = excluded.value,
        description = excluded.description,
        updated_at = now()
    `,
    [key, value, description],
  );
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function normalizeQueuePriorityPolicy(value: unknown): QueuePriorityPolicy | undefined {
  if (
    value === "priority_first" ||
    value === "priority_aging" ||
    value === "repo_fair" ||
    value === "weighted_priority" ||
    value === "oldest_first" ||
    value === "newest_first"
  ) {
    return value;
  }

  return undefined;
}

function isMissingAppSettingsTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}
