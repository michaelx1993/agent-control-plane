import type {
  ActiveRunSnapshot,
  AgentRole,
  RepositoryRef,
  TaskSnapshot,
  WorkflowState,
} from "@agent-control-plane/core";
import { isWorkflowState } from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";
import type { QueuePriorityPolicy } from "./dispatch-settings.js";

interface RepositoryRow {
  id: string;
  slug: string;
  status: "active" | "archived";
}

interface TaskRow {
  id: string;
  identifier: string;
  title: string;
  state: string;
  repository_id: string | null;
  labels: unknown;
  priority: number | null;
  estimated_cost_usd: string | number | null;
  updated_at: Date;
}

interface ActiveRunRow {
  task_id: string;
  repository_id: string;
  role_key: string;
  status: ActiveRunSnapshot["status"];
  lease_expires_at: Date | null;
}

export interface DispatchInputSnapshot {
  tasks: TaskSnapshot[];
  repositories: RepositoryRef[];
  activeRuns: ActiveRunSnapshot[];
}

export interface FetchDispatchInputOptions {
  retryBackoffMs?: number;
  queuePriorityPolicy?: QueuePriorityPolicy;
}

export async function fetchDispatchInputSnapshot(
  client: DatabaseClient,
  options: FetchDispatchInputOptions = {},
): Promise<DispatchInputSnapshot> {
  const tasks = await fetchTaskSnapshots(client, options);
  const repositories = await fetchRepositorySnapshots(client);
  const activeRuns = await fetchActiveRunSnapshots(client);

  return {
    tasks,
    repositories,
    activeRuns,
  };
}

export async function fetchRepositorySnapshots(client: DatabaseClient): Promise<RepositoryRef[]> {
  const result = await client.query<RepositoryRow>(`
    select id, slug, status
    from repositories
    order by slug asc
  `);

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    status: row.status,
  }));
}

export async function fetchTaskSnapshots(
  client: DatabaseClient,
  options: FetchDispatchInputOptions = {},
): Promise<TaskSnapshot[]> {
  const retryBackoffMs = Math.max(0, Math.trunc(options.retryBackoffMs ?? 0));
  const orderBy = buildTaskOrderBy(options.queuePriorityPolicy ?? "priority_first");
  const result = await client.query<TaskRow>(
    `
    select
      id,
      identifier,
      title,
      state,
      repository_id,
      labels,
      priority,
      estimated_cost_usd,
      updated_at
    from tasks
    where state::text in ('Todo', 'Development', 'Code Review', 'In Merge', 'Release Version', 'Deployment')
      and (
        $1::integer = 0
        or not exists (
          select 1
          from runs recent
          left join lateral (
            select payload
            from run_events event
            where event.run_id = recent.id
              and event.event_type = 'failed'
            order by event.created_at desc
            limit 1
          ) failed_event on true
          where recent.task_id = tasks.id
            and recent.status::text in ('failed', 'stalled')
            and recent.finished_at is not null
            and recent.finished_at > now() - ($1::integer * interval '1 millisecond')
            and (
              recent.status::text = 'stalled'
              or coalesce((failed_event.payload->>'retryable')::boolean, true) = true
            )
        )
      )
    ${orderBy}
  `,
    [retryBackoffMs],
  );

  return result.rows.map(mapTaskRow);
}

function buildTaskOrderBy(policy: QueuePriorityPolicy): string {
  switch (policy) {
    case "oldest_first":
      return "order by updated_at asc";
    case "newest_first":
      return "order by updated_at desc";
    case "priority_aging":
      return `
        order by
          (
            coalesce(priority, 1000000)
            - floor(greatest(extract(epoch from (now() - updated_at)), 0) / 86400.0)
          ) asc,
          priority asc nulls last,
          updated_at asc
      `;
    case "repo_fair":
      return `
        order by
          row_number() over (
            partition by repository_id
            order by priority asc nulls last, updated_at asc
          ) asc,
          repository_id asc nulls last,
          priority asc nulls last,
          updated_at asc
      `;
    case "weighted_priority":
      return `
        order by
          (coalesce(priority, 1000000) + coalesce(estimated_cost_usd, 0)) asc,
          priority asc nulls last,
          estimated_cost_usd asc nulls first,
          updated_at asc
      `;
    case "priority_first":
      return "order by priority asc nulls last, updated_at asc";
  }
}

export async function fetchActiveRunSnapshots(
  client: DatabaseClient,
): Promise<ActiveRunSnapshot[]> {
  const result = await client.query<ActiveRunRow>(`
    select
      runs.task_id,
      runs.repository_id,
      roles.key as role_key,
      runs.status,
      runs.lease_expires_at
    from runs
    join roles on roles.id = runs.role_id
    where runs.status in ('queued', 'claimed', 'running')
      and (runs.lease_expires_at is null or runs.lease_expires_at > now())
    order by runs.created_at asc
  `);

  return result.rows.map((row) => {
    const snapshot: ActiveRunSnapshot = {
      taskId: row.task_id,
      repositoryId: row.repository_id,
      role: normalizeAgentRole(row.role_key),
      status: row.status,
    };

    if (row.lease_expires_at) {
      snapshot.leaseExpiresAt = row.lease_expires_at;
    }

    return snapshot;
  });
}

function normalizeAgentRole(value: string): AgentRole {
  switch (value) {
    case "intake":
    case "development":
    case "code_review":
    case "merge":
    case "release":
    case "deploy":
    case "human_gate":
    case "terminal":
      return value;
    default:
      throw new Error(`Unknown agent role from database: ${value}`);
  }
}

function mapTaskRow(row: TaskRow): TaskSnapshot {
  const snapshot: TaskSnapshot = {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    state: normalizeWorkflowState(row.state),
    labels: normalizeLabels(row.labels),
    priority: row.priority,
    updatedAt: row.updated_at,
  };

  const estimatedCostUsd = normalizeEstimatedCost(row.estimated_cost_usd);
  if (estimatedCostUsd !== undefined) {
    snapshot.estimatedCostUsd = estimatedCostUsd;
  }

  if (row.repository_id) {
    snapshot.repositoryId = row.repository_id;
  }

  return snapshot;
}

function normalizeEstimatedCost(value: string | number | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeWorkflowState(value: string): WorkflowState {
  if (!isWorkflowState(value)) {
    throw new Error(`Unknown workflow state from database: ${value}`);
  }

  return value;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
