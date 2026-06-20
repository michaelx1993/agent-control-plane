import {
  resolveRepositoryForTask,
  type RepositoryRef,
  type WorkflowState,
} from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";

export interface ExternalTaskSyncRecord {
  externalTaskId: string;
  identifier: string;
  title: string;
  state: WorkflowState;
  labels: readonly string[];
  priority: number | null;
  estimatedCostUsd?: number | null;
  url?: string;
  syncCursor?: string;
}

export interface SyncExternalTasksInput {
  projectSlug: string;
  tasks: readonly ExternalTaskSyncRecord[];
}

export interface SyncExternalTasksResult {
  projectId: string;
  upserted: number;
  routed: number;
  unrouted: number;
}

export interface PlaneProjectSyncCursor {
  projectSlug: string;
  syncCursor?: string;
}

interface ProjectRow {
  id: string;
}

interface RepositoryRow {
  id: string;
  slug: string;
  status: "active" | "archived";
}

export async function syncExternalTasks(
  client: DatabaseClient,
  input: SyncExternalTasksInput,
): Promise<SyncExternalTasksResult> {
  const projectId = await findProjectId(client, input.projectSlug);
  const repositories = await fetchProjectRepositories(client, projectId);

  let routed = 0;
  let unrouted = 0;

  for (const task of input.tasks) {
    const repositoryId = resolveRepositoryIdForLabels(task.labels, repositories);
    if (repositoryId) {
      routed += 1;
    } else {
      unrouted += 1;
    }

    await upsertTask(client, projectId, task, repositoryId);
  }

  return {
    projectId,
    upserted: input.tasks.length,
    routed,
    unrouted,
  };
}

export async function getPlaneProjectSyncCursor(
  client: DatabaseClient,
  projectSlug: string,
): Promise<string | undefined> {
  const result = await client.query<{ value: unknown }>(
    `
      select value
      from app_settings
      where key = $1
      limit 1
    `,
    [planeProjectSyncCursorKey(projectSlug)],
  );

  return normalizeSyncCursorValue(result.rows[0]?.value);
}

export async function updatePlaneProjectSyncCursor(
  client: DatabaseClient,
  input: PlaneProjectSyncCursor,
): Promise<void> {
  if (!input.syncCursor) {
    return;
  }

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
      planeProjectSyncCursorKey(input.projectSlug),
      input.syncCursor,
      `Plane polling sync cursor for project ${input.projectSlug}.`,
    ],
  );
}

export function resolveRepositoryIdForLabels(
  labels: readonly string[],
  repositories: readonly RepositoryRef[],
): string | undefined {
  return resolveRepositoryForTask({ labels }, repositories)?.id;
}

async function findProjectId(client: DatabaseClient, projectSlug: string): Promise<string> {
  const result = await client.query<ProjectRow>(
    `
      select id
      from projects
      where slug = $1
      limit 1
    `,
    [projectSlug],
  );

  const project = result.rows[0];
  if (!project) {
    throw new Error(`Project not found for slug: ${projectSlug}`);
  }

  return project.id;
}

async function fetchProjectRepositories(
  client: DatabaseClient,
  projectId: string,
): Promise<RepositoryRef[]> {
  const result = await client.query<RepositoryRow>(
    `
      select id, slug, status
      from repositories
      where project_id = $1
      order by slug asc
    `,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    status: row.status,
  }));
}

async function upsertTask(
  client: DatabaseClient,
  projectId: string,
  task: ExternalTaskSyncRecord,
  repositoryId: string | undefined,
): Promise<void> {
  await client.query(
    `
      insert into tasks (
        id,
        project_id,
        repository_id,
        external_task_id,
        identifier,
        title,
        state,
        priority,
        estimated_cost_usd,
        labels,
        url,
        last_synced_at,
        sync_cursor,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, now(), $11, now())
      on conflict (project_id, external_task_id)
      do update set
        repository_id = excluded.repository_id,
        identifier = excluded.identifier,
        title = excluded.title,
        state = excluded.state,
        priority = excluded.priority,
        estimated_cost_usd = excluded.estimated_cost_usd,
        labels = excluded.labels,
        url = excluded.url,
        last_synced_at = now(),
        sync_cursor = excluded.sync_cursor,
        updated_at = now()
    `,
    [
      projectId,
      repositoryId ?? null,
      task.externalTaskId,
      task.identifier,
      task.title,
      task.state,
      task.priority,
      task.estimatedCostUsd ?? parseEstimatedCostFromLabels(task.labels) ?? null,
      JSON.stringify(task.labels),
      task.url ?? null,
      task.syncCursor ?? null,
    ],
  );
}

function parseEstimatedCostFromLabels(labels: readonly string[]): number | undefined {
  for (const label of labels) {
    const match = /^cost:([0-9]+(?:\.[0-9]+)?)$/i.exec(label.trim());
    if (!match) {
      continue;
    }

    const value = Number.parseFloat(match[1] ?? "");
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  return undefined;
}

function planeProjectSyncCursorKey(projectSlug: string): string {
  return `plane.sync_cursor.${projectSlug}`;
}

function normalizeSyncCursorValue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value;
}
