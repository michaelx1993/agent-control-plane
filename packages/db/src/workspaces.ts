import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { DatabaseClient } from "./client.js";

export type WorkspaceStatus = "preparing" | "ready" | "dirty" | "archived" | "cleaned";
export type WorkspaceStrategy = "auto" | "local-path" | "git-worktree" | "ephemeral";

export interface PrepareWorkspaceInput {
  runId: string;
  repositoryId: string;
  repositorySlug: string;
  repositoryLocalPath?: string;
  repositoryDefaultBranch: string;
  workspaceRoot: string;
  strategy?: WorkspaceStrategy;
}

export interface WorkspaceRecord {
  id: string;
  runId: string;
  repositoryId: string;
  strategy: string;
  path: string;
  baseRef?: string;
  headRef?: string;
  status: WorkspaceStatus;
  createdAt: Date;
  cleanedAt?: Date;
}

export interface RecordWorkspaceReadyInput {
  runId: string;
  strategy: string;
  path: string;
  baseRef?: string;
  headRef?: string;
}

export interface WorkspaceCleanupCandidate extends WorkspaceRecord {
  finishedAt: Date;
  repositoryLocalPath?: string;
}

export interface ListWorkspaceCleanupCandidatesInput {
  olderThan: Date;
  limit: number;
}

interface WorkspaceRow {
  id: string;
  run_id: string;
  repository_id: string;
  strategy: string;
  path: string;
  base_ref: string | null;
  head_ref: string | null;
  status: WorkspaceStatus;
  created_at: Date;
  cleaned_at: Date | null;
}

interface WorkspaceCleanupCandidateRow extends WorkspaceRow {
  finished_at: Date;
  repository_local_path: string | null;
}

const execFileAsync = promisify(execFile);

export async function prepareWorkspaceForRun(
  client: DatabaseClient,
  input: PrepareWorkspaceInput,
): Promise<WorkspaceRecord> {
  const eventId = randomUUID();
  const headRef = `agent/${input.runId.slice(0, 8)}`;
  const workspace = await prepareWorkspacePath(input, headRef);

  const result = await client.query<WorkspaceRow>(
    `
      with upserted as (
        insert into workspaces (
          id,
          run_id,
          repository_id,
          strategy,
          path,
          base_ref,
          head_ref,
          status,
          created_at
        )
        values (
          gen_random_uuid(),
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'ready',
          now()
        )
        on conflict (run_id) do update set
          strategy = excluded.strategy,
          path = excluded.path,
          base_ref = excluded.base_ref,
          head_ref = excluded.head_ref,
          status = 'ready'
        returning *
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          $7::uuid,
          run_id,
          'workspace.ready',
          'Workspace prepared for run.',
          jsonb_build_object(
            'strategy', strategy,
            'path', path,
            'baseRef', base_ref,
            'headRef', head_ref
          ),
          now()
        from upserted
        returning run_id
      )
      select * from upserted
    `,
    [
      input.runId,
      input.repositoryId,
      workspace.strategy,
      workspace.path,
      workspace.baseRef,
      headRef,
      eventId,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to prepare workspace for run ${input.runId}`);
  }

  return mapWorkspaceRow(row);
}

export async function listEphemeralWorkspacesForCleanup(
  client: DatabaseClient,
  input: ListWorkspaceCleanupCandidatesInput,
): Promise<WorkspaceCleanupCandidate[]> {
  const result = await client.query<WorkspaceCleanupCandidateRow>(
    `
      select
        workspaces.*,
        runs.finished_at,
        repositories.local_path as repository_local_path
      from workspaces
      join runs on runs.id = workspaces.run_id
      join repositories on repositories.id = workspaces.repository_id
      where workspaces.strategy in ('ephemeral', 'git-worktree')
        and workspaces.status <> 'cleaned'
        and workspaces.cleaned_at is null
        and runs.finished_at is not null
        and runs.finished_at <= $1::timestamptz
      order by runs.finished_at asc
      limit $2::integer
    `,
    [input.olderThan, input.limit],
  );

  return result.rows.map((row) => ({
    ...mapWorkspaceRow(row),
    finishedAt: row.finished_at,
    ...(row.repository_local_path ? { repositoryLocalPath: row.repository_local_path } : {}),
  }));
}

export async function recordWorkspaceReady(
  client: DatabaseClient,
  input: RecordWorkspaceReadyInput,
): Promise<WorkspaceRecord | undefined> {
  const result = await client.query<WorkspaceRow>(
    `
      insert into workspaces (
        id,
        run_id,
        repository_id,
        strategy,
        path,
        base_ref,
        head_ref,
        status,
        created_at
      )
      select
        gen_random_uuid(),
        runs.id,
        runs.repository_id,
        $2,
        $3,
        $4,
        $5,
        'ready',
        now()
      from runs
      where runs.id = $1::uuid
        and runs.repository_id is not null
      on conflict (run_id) do update set
        repository_id = excluded.repository_id,
        strategy = excluded.strategy,
        path = excluded.path,
        base_ref = excluded.base_ref,
        head_ref = excluded.head_ref,
        status = 'ready',
        cleaned_at = null
      returning *
    `,
    [input.runId, input.strategy, input.path, input.baseRef ?? null, input.headRef ?? null],
  );

  const row = result.rows[0];
  return row ? mapWorkspaceRow(row) : undefined;
}

export async function markWorkspaceCleaned(
  client: DatabaseClient,
  input: { workspaceId: string; runId: string; path: string },
): Promise<WorkspaceRecord> {
  const result = await client.query<WorkspaceRow>(
    `
      with updated as (
        update workspaces
        set
          status = 'cleaned',
          cleaned_at = now()
        where id = $1::uuid
          and run_id = $2::uuid
        returning *
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          gen_random_uuid(),
          run_id,
          'workspace.cleaned',
          'Workspace cleaned.',
          jsonb_build_object('workspaceId', id, 'path', $3::text),
          now()
        from updated
        returning run_id
      )
      select * from updated
    `,
    [input.workspaceId, input.runId, input.path],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Workspace not found for cleanup: ${input.workspaceId}`);
  }

  return mapWorkspaceRow(row);
}

function workspacePath(root: string, repositorySlug: string, runId: string): string {
  return `${normalizedWorkspaceRoot(root)}/${safePathSegment(repositorySlug)}/${runId}`;
}

async function prepareWorkspacePath(
  input: PrepareWorkspaceInput,
  headRef: string,
): Promise<{
  strategy: "local-path" | "git-worktree" | "ephemeral";
  path: string;
  baseRef: string;
}> {
  const strategy = resolveWorkspaceStrategy(input);
  const baseRef = input.repositoryDefaultBranch;

  if (strategy === "local-path") {
    const path = input.repositoryLocalPath;
    if (!path) {
      throw new Error("repositoryLocalPath is required for local-path workspace strategy");
    }

    await mkdir(path, { recursive: true });
    return { strategy, path, baseRef };
  }

  const path = workspacePath(input.workspaceRoot, input.repositorySlug, input.runId);

  if (strategy === "git-worktree") {
    const repositoryLocalPath = input.repositoryLocalPath;
    if (!repositoryLocalPath) {
      throw new Error("repositoryLocalPath is required for git-worktree workspace strategy");
    }

    await mkdir(
      `${normalizedWorkspaceRoot(input.workspaceRoot)}/${safePathSegment(input.repositorySlug)}`,
      {
        recursive: true,
      },
    );
    if (!(await pathExists(path))) {
      await execFileAsync("git", [
        "-C",
        repositoryLocalPath,
        "worktree",
        "add",
        "-B",
        headRef,
        path,
        baseRef,
      ]);
    }
    return { strategy, path, baseRef };
  }

  await mkdir(path, { recursive: true });
  return { strategy, path, baseRef };
}

function resolveWorkspaceStrategy(
  input: PrepareWorkspaceInput,
): "local-path" | "git-worktree" | "ephemeral" {
  if (input.strategy === "git-worktree") {
    return input.repositoryLocalPath ? "git-worktree" : "ephemeral";
  }

  if (input.strategy === "local-path") {
    return input.repositoryLocalPath ? "local-path" : "ephemeral";
  }

  if (input.strategy === "ephemeral") {
    return "ephemeral";
  }

  return input.repositoryLocalPath ? "local-path" : "ephemeral";
}

function normalizedWorkspaceRoot(root: string): string {
  return root.replace(/\/+$/, "") || "/tmp/agent-control-plane-workspaces";
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function mapWorkspaceRow(row: WorkspaceRow): WorkspaceRecord {
  const record: WorkspaceRecord = {
    id: row.id,
    runId: row.run_id,
    repositoryId: row.repository_id,
    strategy: row.strategy,
    path: row.path,
    status: row.status,
    createdAt: row.created_at,
  };

  if (row.base_ref) {
    record.baseRef = row.base_ref;
  }

  if (row.head_ref) {
    record.headRef = row.head_ref;
  }

  if (row.cleaned_at) {
    record.cleanedAt = row.cleaned_at;
  }

  return record;
}
