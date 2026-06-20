import { randomUUID } from "node:crypto";
import type { AgentRole } from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";

export type RunStatus = "queued" | "claimed" | "running" | "succeeded" | "failed" | "stalled";

export interface RunClaimInput {
  taskId: string;
  repositoryId: string;
  role: AgentRole;
  leaseOwner: string;
  leaseExpiresAt: Date;
  maxActiveRunsPerRepository?: number;
  maxActiveRunsPerRole?: number;
  maxActiveRunsPerAgent?: number;
}

export interface RunClaimRecord {
  runId: string;
  taskId: string;
  identifier: string;
  repositoryId: string;
  repositorySlug: string;
  repositoryGitUrl: string;
  repositoryDefaultBranch: string;
  repositoryLocalPath?: string;
  role: AgentRole;
  status: "claimed";
  leaseOwner: string;
  leaseExpiresAt: Date;
  attempt: number;
}

export interface RunLifecycleRecord {
  runId: string;
  taskId: string;
  status: "running" | "succeeded" | "failed" | "stalled";
  heartbeatAt?: Date;
  finishedAt?: Date;
  nextState?: string;
}

export interface RunLeaseRecord {
  runId: string;
  taskId: string;
  status: "claimed" | "running";
  leaseOwner: string;
  leaseExpiresAt?: Date;
}

export interface CompleteRunInput {
  runId: string;
  leaseOwner: string;
  resultSummary: string;
  nextState?: string;
  advanceTaskState?: boolean;
}

export interface FailRunInput {
  runId: string;
  leaseOwner: string;
  failureReason: string;
  retryable?: boolean;
}

export interface MarkStalledRunsInput {
  heartbeatStaleBefore: Date;
  leaseExpiredBefore: Date;
  limit?: number;
}

export interface StalledRunRecord {
  runId: string;
  taskId: string;
  status: "stalled";
  heartbeatAt?: Date;
  finishedAt?: Date;
}

export interface RunListFilter {
  status?: RunStatus;
  repositorySlug?: string;
  role?: AgentRole;
  taskIdentifier?: string;
  limit?: number;
}

export interface OperatorRunRecord {
  runId: string;
  taskId: string;
  taskIdentifier: string;
  taskTitle: string;
  repositorySlug: string;
  role: AgentRole;
  status: RunStatus;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  heartbeatAt?: Date;
  attempt: number;
  startedAt?: Date;
  finishedAt?: Date;
  resultSummary?: string;
  failureReason?: string;
  nextState?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunEventRecord {
  id: string;
  eventType: string;
  message: string;
  payload: unknown;
  createdAt: Date;
}

export interface InsertRunEventInput {
  eventType: string;
  message: string;
  payload?: unknown;
}

export interface RunTraceRecord {
  id: string;
  provider: string;
  traceId?: string;
  generationId?: string;
  model?: string;
  promptReleaseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: string;
  latencyMs?: number;
  uiUrl?: string;
  createdAt: Date;
}

export interface RunDetailRecord extends OperatorRunRecord {
  projectSlug: string;
  projectName: string;
  repositoryId: string;
  repositoryGitUrl: string;
  repositoryDefaultBranch: string;
  repositoryLocalPath?: string;
  workspace?: {
    strategy: string;
    path: string;
    baseRef?: string;
    headRef?: string;
    status: string;
    createdAt: Date;
    cleanedAt?: Date;
  };
  agentName: string;
  agentModel: string;
  promptRelease?: {
    id: string;
    contentHash: string;
    createdAt: Date;
  };
  conversation?: {
    provider: string;
    conversationId: string;
    eventLogUri?: string;
    uiUrl?: string;
    updatedAt: Date;
  };
  traces: RunTraceRecord[];
  events: RunEventRecord[];
}

interface ClaimRunRow {
  id: string;
  task_id: string;
  identifier: string;
  repository_id: string;
  repository_slug: string;
  repository_git_url: string;
  repository_default_branch: string;
  repository_local_path: string | null;
  role_key: AgentRole;
  status: "claimed";
  lease_owner: string;
  lease_expires_at: Date;
  attempt: number;
}

interface RunLifecycleRow {
  id: string;
  task_id: string;
  status: "running" | "succeeded" | "failed" | "stalled";
  heartbeat_at: Date | null;
  finished_at: Date | null;
  next_state: string | null;
}

interface RunLeaseRow {
  id: string;
  task_id: string;
  status: "claimed" | "running";
  lease_owner: string;
  lease_expires_at: Date | null;
}

interface OperatorRunRow {
  id: string;
  task_id: string;
  task_identifier: string;
  task_title: string;
  repository_slug: string;
  role_key: AgentRole;
  status: RunStatus;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  attempt: number;
  started_at: Date | null;
  finished_at: Date | null;
  result_summary: string | null;
  failure_reason: string | null;
  next_state: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RunDetailRow extends OperatorRunRow {
  project_slug: string;
  project_name: string;
  repository_id: string;
  repository_git_url: string;
  repository_default_branch: string;
  repository_local_path: string | null;
  workspace_strategy: string | null;
  workspace_path: string | null;
  workspace_base_ref: string | null;
  workspace_head_ref: string | null;
  workspace_status: string | null;
  workspace_created_at: Date | null;
  workspace_cleaned_at: Date | null;
  agent_name: string;
  agent_model: string;
  prompt_release_id: string | null;
  prompt_release_hash: string | null;
  prompt_release_created_at: Date | null;
  conversation_provider: string | null;
  conversation_id: string | null;
  event_log_uri: string | null;
  conversation_ui_url: string | null;
  conversation_updated_at: Date | null;
}

interface RunEventRow {
  id: string;
  event_type: string;
  message: string;
  payload: unknown;
  created_at: Date;
}

interface RunTraceRow {
  id: string;
  provider: string;
  trace_id: string | null;
  generation_id: string | null;
  model: string | null;
  prompt_release_id: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cost_usd: string | null;
  latency_ms: number | null;
  ui_url: string | null;
  created_at: Date;
}

export async function claimRuns(
  client: DatabaseClient,
  claims: readonly RunClaimInput[],
): Promise<RunClaimRecord[]> {
  const claimed: RunClaimRecord[] = [];

  for (const claim of claims) {
    const record = await claimRun(client, claim);
    if (record) {
      claimed.push(record);
    }
  }

  return claimed;
}

export async function markRunRunning(
  client: DatabaseClient,
  runId: string,
  leaseOwner: string,
): Promise<RunLifecycleRecord | undefined> {
  const eventId = randomUUID();
  const result = await client.query<RunLifecycleRow>(
    `
      with updated as (
        update runs
        set
          status = 'running',
          heartbeat_at = now(),
          updated_at = now()
        where id = $1
          and lease_owner = $2
          and status = 'claimed'
          and (lease_expires_at is null or lease_expires_at > now())
        returning id, task_id, status, heartbeat_at, finished_at, next_state
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          $3::uuid,
          id,
          'running',
          'Worker started run execution.',
          jsonb_build_object('workerId', $2),
          now()
        from updated
        returning run_id
      )
      select id, task_id, status, heartbeat_at, finished_at, next_state
      from updated
    `,
    [runId, leaseOwner, eventId],
  );

  return mapLifecycleRow(result.rows[0]);
}

export async function insertRunEvents(
  client: DatabaseClient,
  runId: string,
  events: readonly InsertRunEventInput[],
): Promise<RunEventRecord[]> {
  const inserted: RunEventRecord[] = [];

  for (const event of events) {
    const result = await client.query<RunEventRow>(
      `
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        values (gen_random_uuid(), $1, $2, $3, $4, now())
        returning id, event_type, message, payload, created_at
      `,
      [runId, event.eventType, event.message, event.payload ?? null],
    );
    const row = result.rows[0];
    if (row) {
      inserted.push({
        id: row.id,
        eventType: row.event_type,
        message: row.message,
        payload: row.payload,
        createdAt: row.created_at,
      });
    }
  }

  return inserted;
}

export async function verifyRunLease(
  client: DatabaseClient,
  runId: string,
  leaseOwner: string,
): Promise<RunLeaseRecord | undefined> {
  const result = await client.query<RunLeaseRow>(
    `
      select id, task_id, status, lease_owner, lease_expires_at
      from runs
      where id = $1
        and lease_owner = $2
        and status in ('claimed', 'running')
        and (lease_expires_at is null or lease_expires_at > now())
      limit 1
    `,
    [runId, leaseOwner],
  );

  return mapRunLeaseRow(result.rows[0]);
}

export async function heartbeatRun(
  client: DatabaseClient,
  runId: string,
  leaseOwner: string,
  leaseExpiresAt?: Date,
): Promise<RunLifecycleRecord | undefined> {
  const eventId = randomUUID();
  const nextLeaseExpiresAt = leaseExpiresAt?.toISOString() ?? null;
  const result = await client.query<RunLifecycleRow>(
    `
      with updated as (
        update runs
        set
          heartbeat_at = now(),
          lease_expires_at = coalesce($3::timestamptz, lease_expires_at),
          updated_at = now()
        where id = $1
          and lease_owner = $2
          and status in ('claimed', 'running')
          and (lease_expires_at is null or lease_expires_at > now())
        returning id, task_id, status, heartbeat_at, finished_at, next_state
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          $4::uuid,
          id,
          'heartbeat',
          'Worker heartbeat.',
          jsonb_build_object('workerId', $2, 'leaseExpiresAt', $3::text),
          now()
        from updated
        returning run_id
      )
      select id, task_id, status, heartbeat_at, finished_at, next_state
      from updated
    `,
    [runId, leaseOwner, nextLeaseExpiresAt, eventId],
  );

  return mapLifecycleRow(result.rows[0]);
}

export async function completeRun(
  client: DatabaseClient,
  input: CompleteRunInput,
): Promise<RunLifecycleRecord | undefined> {
  const eventId = randomUUID();
  const result = await client.query<RunLifecycleRow>(
    `
      with updated as (
        update runs
        set
          status = 'succeeded',
          heartbeat_at = now(),
          finished_at = now(),
          result_summary = $3,
          next_state = $4,
          updated_at = now()
        where id = $1
          and lease_owner = $2
          and status in ('claimed', 'running')
          and (lease_expires_at is null or lease_expires_at > now())
        returning id, task_id, status, heartbeat_at, finished_at, next_state
      ),
      task_update as (
        update tasks
        set
          state = $4,
          updated_at = now()
        from updated
        where tasks.id = updated.task_id
          and $5::boolean = true
          and $4 is not null
        returning tasks.id
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          $6::uuid,
          id,
          'completed',
          'Worker completed run.',
          jsonb_build_object(
            'workerId', $2,
            'nextState', $4,
            'advancedTaskState', $5::boolean
          ),
          now()
        from updated
        returning run_id
      )
      select id, task_id, status, heartbeat_at, finished_at, next_state
      from updated
      union all
      select id, task_id, status, heartbeat_at, finished_at, next_state
      from runs
      where id = $1
        and lease_owner = $2
        and status = 'succeeded'
        and result_summary = $3
        and next_state is not distinct from $4
        and not exists (select 1 from updated)
      limit 1
    `,
    [
      input.runId,
      input.leaseOwner,
      input.resultSummary,
      input.nextState ?? null,
      input.advanceTaskState ?? false,
      eventId,
    ],
  );

  return mapLifecycleRow(result.rows[0]);
}

export async function failRun(
  client: DatabaseClient,
  input: FailRunInput,
): Promise<RunLifecycleRecord | undefined> {
  const eventId = randomUUID();
  const result = await client.query<RunLifecycleRow>(
    `
      with updated as (
        update runs
        set
          status = 'failed',
          heartbeat_at = now(),
          finished_at = now(),
          failure_reason = $3,
          updated_at = now()
        where id = $1
          and lease_owner = $2
          and status in ('claimed', 'running')
        returning id, task_id, status, heartbeat_at, finished_at, next_state
      ),
      task_update as (
        update tasks
        set
          state = 'Blocked',
          updated_at = now()
        from updated
        where tasks.id = updated.task_id
          and $4::boolean = false
        returning tasks.id
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          $5::uuid,
          id,
          'failed',
          'Worker failed run.',
          jsonb_build_object(
            'workerId', $2,
            'retryable', $4::boolean,
            'failureReason', $3
          ),
          now()
        from updated
        returning run_id
      )
      select id, task_id, status, heartbeat_at, finished_at, next_state
      from updated
      union all
      select id, task_id, status, heartbeat_at, finished_at, next_state
      from runs
      where id = $1
        and lease_owner = $2
        and status = 'failed'
        and failure_reason = $3
        and not exists (select 1 from updated)
      limit 1
    `,
    [input.runId, input.leaseOwner, input.failureReason, input.retryable ?? true, eventId],
  );

  return mapLifecycleRow(result.rows[0]);
}

export async function markStalledRuns(
  client: DatabaseClient,
  input: MarkStalledRunsInput,
): Promise<StalledRunRecord[]> {
  const eventId = randomUUID();
  const limit = input.limit ?? 50;
  const result = await client.query<RunLifecycleRow>(
    `
      with candidates as (
        select id
        from runs
        where status in ('claimed', 'running')
          and (
            (heartbeat_at is not null and heartbeat_at < $1::timestamptz)
            or (lease_expires_at is not null and lease_expires_at < $2::timestamptz)
          )
        order by coalesce(heartbeat_at, lease_expires_at, created_at) asc
        limit $3
      ),
      updated as (
        update runs
        set
          status = 'stalled',
          finished_at = now(),
          failure_reason = 'Run stalled: heartbeat or lease expired.',
          updated_at = now()
        from candidates
        where runs.id = candidates.id
        returning runs.id, runs.task_id, runs.status, runs.heartbeat_at, runs.finished_at, runs.next_state
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          gen_random_uuid(),
          id,
          'stalled',
          'Run marked stalled because heartbeat or lease expired.',
          jsonb_build_object(
            'heartbeatStaleBefore', $1::text,
            'leaseExpiredBefore', $2::text,
            'markerId', $4::text
          ),
          now()
        from updated
        returning run_id
      )
      select id, task_id, status, heartbeat_at, finished_at, next_state
      from updated
    `,
    [
      input.heartbeatStaleBefore.toISOString(),
      input.leaseExpiredBefore.toISOString(),
      limit,
      eventId,
    ],
  );

  return result.rows.map((row) => ({
    runId: row.id,
    taskId: row.task_id,
    status: "stalled",
    ...(row.heartbeat_at ? { heartbeatAt: row.heartbeat_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  }));
}

export async function listOperatorRuns(
  client: DatabaseClient,
  filter: RunListFilter = {},
): Promise<OperatorRunRecord[]> {
  const limit = clampLimit(filter.limit ?? 50);
  const result = await client.query<OperatorRunRow>(
    `
      select
        runs.id,
        runs.task_id,
        tasks.identifier as task_identifier,
        tasks.title as task_title,
        repositories.slug as repository_slug,
        roles.key as role_key,
        runs.status,
        runs.lease_owner,
        runs.lease_expires_at,
        runs.heartbeat_at,
        runs.attempt,
        runs.started_at,
        runs.finished_at,
        runs.result_summary,
        runs.failure_reason,
        runs.next_state,
        runs.created_at,
        runs.updated_at
      from runs
      join tasks on tasks.id = runs.task_id
      join repositories on repositories.id = runs.repository_id
      join roles on roles.id = runs.role_id
      where ($1::text is null or runs.status::text = $1)
        and ($2::text is null or repositories.slug = $2)
        and ($3::text is null or roles.key = $3)
        and ($4::text is null or tasks.identifier = $4)
      order by runs.created_at desc
      limit $5
    `,
    [
      filter.status ?? null,
      filter.repositorySlug ?? null,
      filter.role ?? null,
      filter.taskIdentifier ?? null,
      limit,
    ],
  );

  return result.rows.map(mapOperatorRunRow);
}

export async function getRunDetail(
  client: DatabaseClient,
  runId: string,
): Promise<RunDetailRecord | undefined> {
  const result = await client.query<RunDetailRow>(
    `
      select
        runs.id,
        runs.task_id,
        tasks.identifier as task_identifier,
        tasks.title as task_title,
        repositories.slug as repository_slug,
        roles.key as role_key,
        runs.status,
        runs.lease_owner,
        runs.lease_expires_at,
        runs.heartbeat_at,
        runs.attempt,
        runs.started_at,
        runs.finished_at,
        runs.result_summary,
        runs.failure_reason,
        runs.next_state,
        runs.created_at,
        runs.updated_at,
        projects.slug as project_slug,
        projects.name as project_name,
        repositories.id as repository_id,
        repositories.git_url as repository_git_url,
        repositories.default_branch as repository_default_branch,
        repositories.local_path as repository_local_path,
        workspaces.strategy as workspace_strategy,
        workspaces.path as workspace_path,
        workspaces.base_ref as workspace_base_ref,
        workspaces.head_ref as workspace_head_ref,
        workspaces.status as workspace_status,
        workspaces.created_at as workspace_created_at,
        workspaces.cleaned_at as workspace_cleaned_at,
        agent_definitions.name as agent_name,
        agent_definitions.model as agent_model,
        prompt_releases.id as prompt_release_id,
        prompt_releases.content_hash as prompt_release_hash,
        prompt_releases.created_at as prompt_release_created_at,
        conversation_refs.provider as conversation_provider,
        conversation_refs.conversation_id,
        conversation_refs.event_log_uri,
        conversation_refs.ui_url as conversation_ui_url,
        conversation_refs.updated_at as conversation_updated_at
      from runs
      join tasks on tasks.id = runs.task_id
      join projects on projects.id = tasks.project_id
      join repositories on repositories.id = runs.repository_id
      join roles on roles.id = runs.role_id
      join agent_definitions on agent_definitions.id = runs.agent_definition_id
      left join prompt_releases on prompt_releases.id = runs.prompt_release_id
      left join conversation_refs on conversation_refs.run_id = runs.id
      left join workspaces on workspaces.run_id = runs.id
      where runs.id = $1
      limit 1
    `,
    [runId],
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  const [events, traces] = await Promise.all([
    listRunEvents(client, runId),
    listRunTraces(client, runId),
  ]);

  const detail: RunDetailRecord = {
    ...mapOperatorRunRow(row),
    projectSlug: row.project_slug,
    projectName: row.project_name,
    repositoryId: row.repository_id,
    repositoryGitUrl: row.repository_git_url,
    repositoryDefaultBranch: row.repository_default_branch,
    agentName: row.agent_name,
    agentModel: row.agent_model,
    traces,
    events,
  };

  if (row.repository_local_path) {
    detail.repositoryLocalPath = row.repository_local_path;
  }

  if (
    row.workspace_strategy &&
    row.workspace_path &&
    row.workspace_status &&
    row.workspace_created_at
  ) {
    detail.workspace = {
      strategy: row.workspace_strategy,
      path: row.workspace_path,
      status: row.workspace_status,
      createdAt: row.workspace_created_at,
      ...(row.workspace_base_ref ? { baseRef: row.workspace_base_ref } : {}),
      ...(row.workspace_head_ref ? { headRef: row.workspace_head_ref } : {}),
      ...(row.workspace_cleaned_at ? { cleanedAt: row.workspace_cleaned_at } : {}),
    };
  }

  if (row.prompt_release_id && row.prompt_release_hash && row.prompt_release_created_at) {
    detail.promptRelease = {
      id: row.prompt_release_id,
      contentHash: row.prompt_release_hash,
      createdAt: row.prompt_release_created_at,
    };
  }

  if (row.conversation_provider && row.conversation_id && row.conversation_updated_at) {
    detail.conversation = {
      provider: row.conversation_provider,
      conversationId: row.conversation_id,
      updatedAt: row.conversation_updated_at,
    };

    if (row.event_log_uri) {
      detail.conversation.eventLogUri = row.event_log_uri;
    }

    if (row.conversation_ui_url) {
      detail.conversation.uiUrl = row.conversation_ui_url;
    }
  }

  return detail;
}

async function listRunEvents(client: DatabaseClient, runId: string): Promise<RunEventRecord[]> {
  const result = await client.query<RunEventRow>(
    `
      select id, event_type, message, payload, created_at
      from run_events
      where run_id = $1
      order by created_at asc
    `,
    [runId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    message: row.message,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

async function listRunTraces(client: DatabaseClient, runId: string): Promise<RunTraceRecord[]> {
  const result = await client.query<RunTraceRow>(
    `
      select
        id,
        provider,
        trace_id,
        generation_id,
        model,
        prompt_release_id,
        input_tokens,
        output_tokens,
        cost_usd,
        latency_ms,
        ui_url,
        created_at
      from trace_refs
      where run_id = $1
      order by created_at asc
    `,
    [runId],
  );

  return result.rows.map(mapTraceRow);
}

async function claimRun(
  client: DatabaseClient,
  claim: RunClaimInput,
): Promise<RunClaimRecord | undefined> {
  const runId = randomUUID();
  const eventId = randomUUID();
  const leaseExpiresAt = claim.leaseExpiresAt.toISOString();

  const result = await client.query<ClaimRunRow>(
    `
      with locks as (
        select
          pg_advisory_xact_lock(hashtext('acp-repository:' || $2::uuid::text)::bigint) as repository_lock,
          pg_advisory_xact_lock(hashtext('acp-role:' || $4::text)::bigint) as role_lock
      ),
      selected as (
        select
          t.id as task_id,
          t.identifier,
          t.repository_id,
          repo.slug as repository_slug,
          repo.git_url as repository_git_url,
          repo.default_branch as repository_default_branch,
          repo.local_path as repository_local_path,
          r.id as role_id,
          r.key as role_key,
          ad.id as agent_definition_id,
          (
            select count(*)
            from runs active_agent
            where active_agent.agent_definition_id = ad.id
              and active_agent.status in ('queued', 'claimed', 'running')
              and (
                active_agent.lease_expires_at is null
                or active_agent.lease_expires_at > now()
              )
          ) as active_agent_runs,
          coalesce(max(previous.attempt), 0) + 1 as next_attempt
        from tasks t
        join repositories repo on repo.id = t.repository_id
        join roles r on r.key = $4
        join agent_definitions ad on ad.role_id = r.id and ad.status = 'active'
        left join runs previous on previous.task_id = t.id
        cross join locks
        where t.id = $1::uuid
          and t.repository_id = $2::uuid
          and t.state::text not in ('Done', 'Canceled', 'Duplicate')
          and not exists (
            select 1
            from runs active
            where active.task_id = t.id
              and active.status in ('queued', 'claimed', 'running')
              and (active.lease_expires_at is null or active.lease_expires_at > now())
          )
          and (
            $8::integer is null
            or (
              select count(*)
              from runs active_repository
              where active_repository.repository_id = t.repository_id
                and active_repository.status in ('queued', 'claimed', 'running')
                and (
                  active_repository.lease_expires_at is null
                  or active_repository.lease_expires_at > now()
                )
            ) < $8::integer
          )
          and (
            $9::integer is null
            or (
              select count(*)
              from runs active_role
              where active_role.role_id = r.id
                and active_role.status in ('queued', 'claimed', 'running')
                and (
                  active_role.lease_expires_at is null
                  or active_role.lease_expires_at > now()
                )
            ) < $9::integer
          )
          and (
            $10::integer is null
            or (
              select count(*)
              from runs active_agent
              where active_agent.agent_definition_id = ad.id
                and active_agent.status in ('queued', 'claimed', 'running')
                and (
                  active_agent.lease_expires_at is null
                  or active_agent.lease_expires_at > now()
                )
            ) < $10::integer
          )
        group by
          t.id,
          t.identifier,
          t.repository_id,
          repo.slug,
          repo.git_url,
          repo.default_branch,
          repo.local_path,
          r.id,
          r.key,
          ad.id
        order by active_agent_runs asc, ad.created_at asc
        limit 1
      ),
      inserted as (
        insert into runs (
          id,
          task_id,
          repository_id,
          role_id,
          agent_definition_id,
          status,
          lease_owner,
          lease_expires_at,
          heartbeat_at,
          attempt,
          started_at,
          created_at,
          updated_at
        )
        select
          $3::uuid,
          task_id,
          repository_id,
          role_id,
          agent_definition_id,
          'claimed',
          $5,
          $6::timestamptz,
          now(),
          next_attempt,
          now(),
          now(),
          now()
        from selected
        returning id, task_id, repository_id, status, lease_owner, lease_expires_at, attempt
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          $7::uuid,
          inserted.id,
          'claimed',
          'Worker claimed task lease.',
          jsonb_build_object('workerId', $5, 'leaseExpiresAt', $6::text),
          now()
        from inserted
        returning run_id
      )
      select
        inserted.id,
        inserted.task_id,
        inserted.repository_id,
        selected.identifier,
        selected.repository_slug,
        selected.repository_git_url,
        selected.repository_default_branch,
        selected.repository_local_path,
        selected.role_key,
        inserted.status,
        inserted.lease_owner,
        inserted.lease_expires_at,
        inserted.attempt
      from inserted
      join selected on selected.task_id = inserted.task_id
    `,
    [
      claim.taskId,
      claim.repositoryId,
      runId,
      claim.role,
      claim.leaseOwner,
      leaseExpiresAt,
      eventId,
      claim.maxActiveRunsPerRepository ?? null,
      claim.maxActiveRunsPerRole ?? null,
      claim.maxActiveRunsPerAgent ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  const record: RunClaimRecord = {
    runId: row.id,
    taskId: row.task_id,
    identifier: row.identifier,
    repositoryId: row.repository_id,
    repositorySlug: row.repository_slug,
    repositoryGitUrl: row.repository_git_url,
    repositoryDefaultBranch: row.repository_default_branch,
    role: row.role_key,
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    attempt: row.attempt,
  };

  if (row.repository_local_path) {
    record.repositoryLocalPath = row.repository_local_path;
  }

  return record;
}

function mapLifecycleRow(row: RunLifecycleRow | undefined): RunLifecycleRecord | undefined {
  if (!row) {
    return undefined;
  }

  const record: RunLifecycleRecord = {
    runId: row.id,
    taskId: row.task_id,
    status: row.status,
  };

  if (row.heartbeat_at) {
    record.heartbeatAt = row.heartbeat_at;
  }

  if (row.finished_at) {
    record.finishedAt = row.finished_at;
  }

  if (row.next_state) {
    record.nextState = row.next_state;
  }

  return record;
}

function mapRunLeaseRow(row: RunLeaseRow | undefined): RunLeaseRecord | undefined {
  if (!row) {
    return undefined;
  }

  const record: RunLeaseRecord = {
    runId: row.id,
    taskId: row.task_id,
    status: row.status,
    leaseOwner: row.lease_owner,
  };

  if (row.lease_expires_at) {
    record.leaseExpiresAt = row.lease_expires_at;
  }

  return record;
}

function mapOperatorRunRow(row: OperatorRunRow): OperatorRunRecord {
  const record: OperatorRunRecord = {
    runId: row.id,
    taskId: row.task_id,
    taskIdentifier: row.task_identifier,
    taskTitle: row.task_title,
    repositorySlug: row.repository_slug,
    role: row.role_key,
    status: row.status,
    attempt: row.attempt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.lease_owner) {
    record.leaseOwner = row.lease_owner;
  }

  if (row.lease_expires_at) {
    record.leaseExpiresAt = row.lease_expires_at;
  }

  if (row.heartbeat_at) {
    record.heartbeatAt = row.heartbeat_at;
  }

  if (row.started_at) {
    record.startedAt = row.started_at;
  }

  if (row.finished_at) {
    record.finishedAt = row.finished_at;
  }

  if (row.result_summary) {
    record.resultSummary = row.result_summary;
  }

  if (row.failure_reason) {
    record.failureReason = row.failure_reason;
  }

  if (row.next_state) {
    record.nextState = row.next_state;
  }

  return record;
}

function mapTraceRow(row: RunTraceRow): RunTraceRecord {
  const record: RunTraceRecord = {
    id: row.id,
    provider: row.provider,
    createdAt: row.created_at,
  };

  if (row.trace_id) {
    record.traceId = row.trace_id;
  }

  if (row.generation_id) {
    record.generationId = row.generation_id;
  }

  if (row.model) {
    record.model = row.model;
  }

  if (row.prompt_release_id) {
    record.promptReleaseId = row.prompt_release_id;
  }

  if (row.input_tokens) {
    record.inputTokens = Number.parseInt(row.input_tokens, 10);
  }

  if (row.output_tokens) {
    record.outputTokens = Number.parseInt(row.output_tokens, 10);
  }

  if (row.cost_usd) {
    record.costUsd = row.cost_usd;
  }

  if (row.latency_ms !== null) {
    record.latencyMs = row.latency_ms;
  }

  if (row.ui_url) {
    record.uiUrl = row.ui_url;
  }

  return record;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}
