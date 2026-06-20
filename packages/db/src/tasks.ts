import {
  automaticStates,
  canTransition,
  isAutomaticState,
  isManualGateState,
  isTerminalState,
  isWorkflowState,
  manualGateStates,
  nextStatesFor,
  roleForState,
  terminalStates,
  type AgentRole,
  type WorkflowState,
} from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";

export type TaskQueueMode = "all" | "agent" | "human" | "terminal" | "blocked";
export type TaskLeaseFilter = "active" | "none" | "expired";
export type TaskRetryFilter = "retryable" | "waiting" | "ready" | "blocked";

export interface TaskExternalRef {
  taskId: string;
  externalTaskId: string;
  identifier: string;
  state: WorkflowState;
  url?: string;
}

export interface TaskQueueFilter {
  state?: WorkflowState;
  projectSlug?: string;
  repositorySlug?: string;
  mode?: TaskQueueMode;
  lease?: TaskLeaseFilter;
  retry?: TaskRetryFilter;
  retryBackoffMs?: number;
  limit?: number;
}

export interface TaskQueueRecord {
  taskId: string;
  externalTaskId: string;
  identifier: string;
  title: string;
  state: WorkflowState;
  mode: TaskQueueMode;
  role: AgentRole;
  priority?: number;
  labels: string[];
  assignee?: string;
  url?: string;
  projectSlug: string;
  projectName: string;
  repositorySlug?: string;
  latestRun?: TaskRunSummary;
  activeRun?: TaskRunSummary;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskDetailRecord extends TaskQueueRecord {
  externalTaskId: string;
  allowedNextStates: WorkflowState[];
  runs: TaskRunSummary[];
  unresolvedFeedback: TaskFeedbackSummary[];
  progressItems: TaskFeedbackSummary[];
}

export interface TaskRunSummary {
  runId: string;
  status: string;
  role: AgentRole;
  attempt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  heartbeatAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  resultSummary?: string;
  failureReason?: string;
  retryable?: boolean;
  retryAfterAt?: Date;
  nextState?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskFeedbackSummary {
  id: string;
  source: string;
  severity: string;
  body: string;
  externalUrl?: string;
  createdAt: Date;
}

export interface TaskTransitionInput {
  taskId: string;
  targetState: WorkflowState;
  actor?: string;
  reason?: string;
}

export interface TaskTransitionResult {
  updated: boolean;
  taskId?: string;
  previousState?: WorkflowState;
  nextState?: WorkflowState;
  reason?: "task_not_found" | "invalid_state" | "target_invalid" | "transition_not_allowed";
}

interface TaskExternalRefRow {
  id: string;
  external_task_id: string;
  identifier: string;
  state: string;
  url: string | null;
}

interface TaskQueueRow {
  id: string;
  external_task_id: string;
  identifier: string;
  title: string;
  state: string;
  priority: number | null;
  labels: unknown;
  assignee: string | null;
  url: string | null;
  project_slug: string;
  project_name: string;
  repository_slug: string | null;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_role: AgentRole | null;
  latest_run_attempt: number | null;
  latest_run_lease_owner: string | null;
  latest_run_lease_expires_at: Date | null;
  latest_run_heartbeat_at: Date | null;
  latest_run_started_at: Date | null;
  latest_run_finished_at: Date | null;
  latest_run_result_summary: string | null;
  latest_run_failure_reason: string | null;
  latest_run_retryable: boolean | null;
  latest_run_retry_after_at: Date | null;
  latest_run_next_state: string | null;
  latest_run_created_at: Date | null;
  latest_run_updated_at: Date | null;
  active_run_id: string | null;
  active_run_status: string | null;
  active_run_role: AgentRole | null;
  active_run_attempt: number | null;
  active_run_lease_owner: string | null;
  active_run_lease_expires_at: Date | null;
  active_run_heartbeat_at: Date | null;
  active_run_started_at: Date | null;
  active_run_finished_at: Date | null;
  active_run_result_summary: string | null;
  active_run_failure_reason: string | null;
  active_run_retryable: boolean | null;
  active_run_retry_after_at: Date | null;
  active_run_next_state: string | null;
  active_run_created_at: Date | null;
  active_run_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface TaskRunRow {
  id: string;
  status: string;
  role_key: AgentRole;
  attempt: number | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  result_summary: string | null;
  failure_reason: string | null;
  retryable: boolean | null;
  retry_after_at: Date | null;
  next_state: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TaskFeedbackRow {
  id: string;
  source: string;
  severity: string;
  body: string;
  external_url: string | null;
  created_at: Date;
}

interface TaskTransitionRow {
  id: string;
  previous_state: string;
  next_state: string;
}

export async function fetchTaskExternalRef(
  client: DatabaseClient,
  taskId: string,
): Promise<TaskExternalRef | undefined> {
  const result = await client.query<TaskExternalRefRow>(
    `
      select id, external_task_id, identifier, state, url
      from tasks
      where id = $1
      limit 1
    `,
    [taskId],
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  if (!isWorkflowState(row.state)) {
    throw new Error(`Unknown workflow state from database: ${row.state}`);
  }

  const ref: TaskExternalRef = {
    taskId: row.id,
    externalTaskId: row.external_task_id,
    identifier: row.identifier,
    state: row.state,
  };

  if (row.url) {
    ref.url = row.url;
  }

  return ref;
}

export async function listOperatorTasks(
  client: DatabaseClient,
  filter: TaskQueueFilter = {},
): Promise<TaskQueueRecord[]> {
  const limit = clampLimit(filter.limit ?? 50);
  const retryBackoffMs = normalizeRetryBackoffMs(filter.retryBackoffMs);
  const modeStates = statesForMode(filter.mode);
  const result = await client.query<TaskQueueRow>(
    `
      select
        tasks.id,
        tasks.external_task_id,
        tasks.identifier,
        tasks.title,
        tasks.state,
        tasks.priority,
        tasks.labels,
        tasks.assignee,
        tasks.url,
        projects.slug as project_slug,
        projects.name as project_name,
        repositories.slug as repository_slug,
        latest_run.id as latest_run_id,
        latest_run.status as latest_run_status,
        latest_run.role_key as latest_run_role,
        latest_run.attempt as latest_run_attempt,
        latest_run.lease_owner as latest_run_lease_owner,
        latest_run.lease_expires_at as latest_run_lease_expires_at,
        latest_run.heartbeat_at as latest_run_heartbeat_at,
        latest_run.started_at as latest_run_started_at,
        latest_run.finished_at as latest_run_finished_at,
        latest_run.result_summary as latest_run_result_summary,
        latest_run.failure_reason as latest_run_failure_reason,
        latest_run.retryable as latest_run_retryable,
        latest_run.retry_after_at as latest_run_retry_after_at,
        latest_run.next_state as latest_run_next_state,
        latest_run.created_at as latest_run_created_at,
        latest_run.updated_at as latest_run_updated_at,
        active_run.id as active_run_id,
        active_run.status as active_run_status,
        active_run.role_key as active_run_role,
        active_run.attempt as active_run_attempt,
        active_run.lease_owner as active_run_lease_owner,
        active_run.lease_expires_at as active_run_lease_expires_at,
        active_run.heartbeat_at as active_run_heartbeat_at,
        active_run.started_at as active_run_started_at,
        active_run.finished_at as active_run_finished_at,
        active_run.result_summary as active_run_result_summary,
        active_run.failure_reason as active_run_failure_reason,
        active_run.retryable as active_run_retryable,
        active_run.retry_after_at as active_run_retry_after_at,
        active_run.next_state as active_run_next_state,
        active_run.created_at as active_run_created_at,
        active_run.updated_at as active_run_updated_at,
        tasks.created_at,
        tasks.updated_at
      from tasks
      join projects on projects.id = tasks.project_id
      left join repositories on repositories.id = tasks.repository_id
      left join lateral (
        select
          runs.id,
          runs.status,
          roles.key as role_key,
          runs.attempt,
          runs.lease_owner,
          runs.lease_expires_at,
          runs.heartbeat_at,
          runs.started_at,
          runs.finished_at,
          runs.result_summary,
          runs.failure_reason,
          case
            when runs.status::text = 'stalled' then true
            when runs.status::text = 'failed' then coalesce((failed_event.payload->>'retryable')::boolean, true)
            else null
          end as retryable,
          case
            when runs.status::text in ('failed', 'stalled')
              and runs.finished_at is not null
              and (
                runs.status::text = 'stalled'
                or coalesce((failed_event.payload->>'retryable')::boolean, true) = true
              )
            then runs.finished_at + ($6::integer * interval '1 millisecond')
            else null
          end as retry_after_at,
          runs.next_state,
          runs.created_at,
          runs.updated_at
        from runs
        join roles on roles.id = runs.role_id
        left join lateral (
          select payload
          from run_events
          where run_events.run_id = runs.id
            and run_events.event_type = 'failed'
          order by run_events.created_at desc
          limit 1
        ) failed_event on true
        where runs.task_id = tasks.id
        order by runs.created_at desc
        limit 1
      ) latest_run on true
      left join lateral (
        select
          runs.id,
          runs.status,
          roles.key as role_key,
          runs.attempt,
          runs.lease_owner,
          runs.lease_expires_at,
          runs.heartbeat_at,
          runs.started_at,
          runs.finished_at,
          runs.result_summary,
          runs.failure_reason,
          null::boolean as retryable,
          null::timestamptz as retry_after_at,
          runs.next_state,
          runs.created_at,
          runs.updated_at
        from runs
        join roles on roles.id = runs.role_id
        where runs.task_id = tasks.id
          and runs.status::text in ('queued', 'claimed', 'running')
          and (runs.lease_expires_at is null or runs.lease_expires_at > now())
        order by runs.created_at desc
        limit 1
      ) active_run on true
      where ($1::text is null or tasks.state::text = $1)
        and ($2::text[] is null or tasks.state::text = any($2::text[]))
        and ($3::text is null or projects.slug = $3)
        and ($4::text is null or repositories.slug = $4)
        and (
          $7::text is null
          or ($7 = 'active' and active_run.id is not null)
          or ($7 = 'none' and active_run.id is null)
          or (
            $7 = 'expired'
            and active_run.id is null
            and latest_run.status::text in ('queued', 'claimed', 'running')
            and latest_run.lease_expires_at is not null
            and latest_run.lease_expires_at <= now()
          )
        )
        and (
          $8::text is null
          or (
            $8 = 'retryable'
            and latest_run.status::text in ('failed', 'stalled')
            and latest_run.retryable = true
          )
          or (
            $8 = 'waiting'
            and latest_run.status::text in ('failed', 'stalled')
            and latest_run.retryable = true
            and latest_run.retry_after_at > now()
          )
          or (
            $8 = 'ready'
            and latest_run.status::text in ('failed', 'stalled')
            and latest_run.retryable = true
            and (latest_run.retry_after_at is null or latest_run.retry_after_at <= now())
          )
          or (
            $8 = 'blocked'
            and latest_run.status::text = 'failed'
            and latest_run.retryable = false
          )
        )
      order by
        case when active_run.id is null then 1 else 0 end,
        tasks.priority asc nulls last,
        tasks.updated_at asc
      limit $5
    `,
    [
      filter.state ?? null,
      modeStates,
      filter.projectSlug ?? null,
      filter.repositorySlug ?? null,
      limit,
      retryBackoffMs,
      filter.lease ?? null,
      filter.retry ?? null,
    ],
  );

  return result.rows.map(mapTaskQueueRow);
}

export async function getTaskDetail(
  client: DatabaseClient,
  taskId: string,
): Promise<TaskDetailRecord | undefined> {
  const retryBackoffMs = normalizeRetryBackoffMs();
  const result = await client.query<TaskQueueRow>(
    `
      select
        tasks.id,
        tasks.external_task_id,
        tasks.identifier,
        tasks.title,
        tasks.state,
        tasks.priority,
        tasks.labels,
        tasks.assignee,
        tasks.url,
        projects.slug as project_slug,
        projects.name as project_name,
        repositories.slug as repository_slug,
        latest_run.id as latest_run_id,
        latest_run.status as latest_run_status,
        latest_run.role_key as latest_run_role,
        latest_run.attempt as latest_run_attempt,
        latest_run.lease_owner as latest_run_lease_owner,
        latest_run.lease_expires_at as latest_run_lease_expires_at,
        latest_run.heartbeat_at as latest_run_heartbeat_at,
        latest_run.started_at as latest_run_started_at,
        latest_run.finished_at as latest_run_finished_at,
        latest_run.result_summary as latest_run_result_summary,
        latest_run.failure_reason as latest_run_failure_reason,
        latest_run.retryable as latest_run_retryable,
        latest_run.retry_after_at as latest_run_retry_after_at,
        latest_run.next_state as latest_run_next_state,
        latest_run.created_at as latest_run_created_at,
        latest_run.updated_at as latest_run_updated_at,
        active_run.id as active_run_id,
        active_run.status as active_run_status,
        active_run.role_key as active_run_role,
        active_run.attempt as active_run_attempt,
        active_run.lease_owner as active_run_lease_owner,
        active_run.lease_expires_at as active_run_lease_expires_at,
        active_run.heartbeat_at as active_run_heartbeat_at,
        active_run.started_at as active_run_started_at,
        active_run.finished_at as active_run_finished_at,
        active_run.result_summary as active_run_result_summary,
        active_run.failure_reason as active_run_failure_reason,
        active_run.retryable as active_run_retryable,
        active_run.retry_after_at as active_run_retry_after_at,
        active_run.next_state as active_run_next_state,
        active_run.created_at as active_run_created_at,
        active_run.updated_at as active_run_updated_at,
        tasks.created_at,
        tasks.updated_at
      from tasks
      join projects on projects.id = tasks.project_id
      left join repositories on repositories.id = tasks.repository_id
      left join lateral (
        select
          runs.id,
          runs.status,
          roles.key as role_key,
          runs.attempt,
          runs.lease_owner,
          runs.lease_expires_at,
          runs.heartbeat_at,
          runs.started_at,
          runs.finished_at,
          runs.result_summary,
          runs.failure_reason,
          case
            when runs.status::text = 'stalled' then true
            when runs.status = 'failed' then coalesce((failed_event.payload->>'retryable')::boolean, true)
            else null
          end as retryable,
          case
            when runs.status::text in ('failed', 'stalled')
              and runs.finished_at is not null
              and (
                runs.status::text = 'stalled'
                or coalesce((failed_event.payload->>'retryable')::boolean, true) = true
              )
            then runs.finished_at + ($2::integer * interval '1 millisecond')
            else null
          end as retry_after_at,
          runs.next_state,
          runs.created_at,
          runs.updated_at
        from runs
        join roles on roles.id = runs.role_id
        left join lateral (
          select payload
          from run_events
          where run_events.run_id = runs.id
            and run_events.event_type = 'failed'
          order by run_events.created_at desc
          limit 1
        ) failed_event on true
        where runs.task_id = tasks.id
        order by runs.created_at desc
        limit 1
      ) latest_run on true
      left join lateral (
        select
          runs.id,
          runs.status,
          roles.key as role_key,
          runs.attempt,
          runs.lease_owner,
          runs.lease_expires_at,
          runs.heartbeat_at,
          runs.started_at,
          runs.finished_at,
          runs.result_summary,
          runs.failure_reason,
          null::boolean as retryable,
          null::timestamptz as retry_after_at,
          runs.next_state,
          runs.created_at,
          runs.updated_at
        from runs
        join roles on roles.id = runs.role_id
        where runs.task_id = tasks.id
          and runs.status in ('queued', 'claimed', 'running')
          and (runs.lease_expires_at is null or runs.lease_expires_at > now())
        order by runs.created_at desc
        limit 1
      ) active_run on true
      where tasks.id = $1
      limit 1
    `,
    [taskId, retryBackoffMs],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return buildTaskDetail(client, mapTaskQueueRow(row));
}

export async function transitionTaskState(
  client: DatabaseClient,
  input: TaskTransitionInput,
): Promise<TaskTransitionResult> {
  if (!isWorkflowState(input.targetState)) {
    return {
      updated: false,
      taskId: input.taskId,
      reason: "target_invalid",
    };
  }

  const current = await client.query<{ id: string; state: string }>(
    `
      select id, state
      from tasks
      where id = $1
      limit 1
    `,
    [input.taskId],
  );
  const task = current.rows[0];
  if (!task) {
    return {
      updated: false,
      reason: "task_not_found",
    };
  }

  if (!isWorkflowState(task.state)) {
    return {
      updated: false,
      taskId: input.taskId,
      reason: "invalid_state",
    };
  }

  if (!canTransition(task.state, input.targetState)) {
    return {
      updated: false,
      taskId: input.taskId,
      previousState: task.state,
      reason: "transition_not_allowed",
    };
  }

  const result = await client.query<TaskTransitionRow>(
    `
      with previous as (
        select id, state
        from tasks
        where id = $1
      ),
      updated as (
        update tasks
        set state = $2, updated_at = now()
        from previous
        where tasks.id = previous.id
        returning tasks.id, tasks.state
      ),
      audit as (
        insert into audit_events (
          id,
          action,
          entity_type,
          entity_id,
          message,
          payload,
          created_at
        )
        select
          gen_random_uuid(),
          'task.transition',
          'task',
          updated.id,
          'Task state transitioned by operator.',
          jsonb_build_object(
            'actor', $3::text,
            'reason', $4::text,
            'previousState', previous.state,
            'nextState', updated.state
          ),
          now()
        from previous, updated
        returning id
      )
      select
        updated.id,
        previous.state as previous_state,
        updated.state as next_state
      from previous, updated
    `,
    [input.taskId, input.targetState, input.actor ?? "operator", input.reason ?? null],
  );

  const row = result.rows[0];
  if (!row || !isWorkflowState(row.previous_state) || !isWorkflowState(row.next_state)) {
    return {
      updated: false,
      taskId: input.taskId,
      reason: "invalid_state",
    };
  }

  return {
    updated: true,
    taskId: row.id,
    previousState: row.previous_state,
    nextState: row.next_state,
  };
}

async function buildTaskDetail(
  client: DatabaseClient,
  task: TaskQueueRecord,
): Promise<TaskDetailRecord> {
  const [runs, unresolvedFeedback, progressItems] = await Promise.all([
    listTaskRuns(client, task.taskId),
    listUnresolvedFeedback(client, task.taskId),
    listTaskProgress(client, task.taskId),
  ]);
  const allowedNextStates = nextStatesFor(task.state).filter(isWorkflowState);

  return {
    ...task,
    externalTaskId: task.externalTaskId,
    allowedNextStates: [...allowedNextStates],
    runs,
    unresolvedFeedback,
    progressItems,
  };
}

async function listTaskRuns(
  client: DatabaseClient,
  taskId: string,
  retryBackoffMs = normalizeRetryBackoffMs(),
): Promise<TaskRunSummary[]> {
  const result = await client.query<TaskRunRow>(
    `
      select
        runs.id,
        runs.status,
        roles.key as role_key,
        runs.attempt,
        runs.lease_owner,
        runs.lease_expires_at,
        runs.heartbeat_at,
        runs.started_at,
        runs.finished_at,
        runs.result_summary,
        runs.failure_reason,
        case
          when runs.status::text = 'stalled' then true
          when runs.status = 'failed' then coalesce((failed_event.payload->>'retryable')::boolean, true)
          else null
        end as retryable,
        case
          when runs.status::text in ('failed', 'stalled')
            and runs.finished_at is not null
            and (
              runs.status::text = 'stalled'
              or coalesce((failed_event.payload->>'retryable')::boolean, true) = true
            )
          then runs.finished_at + ($2::integer * interval '1 millisecond')
          else null
        end as retry_after_at,
        runs.next_state,
        runs.created_at,
        runs.updated_at
      from runs
      join roles on roles.id = runs.role_id
      left join lateral (
        select payload
        from run_events
        where run_events.run_id = runs.id
          and run_events.event_type = 'failed'
        order by run_events.created_at desc
        limit 1
      ) failed_event on true
      where runs.task_id = $1
      order by runs.created_at desc
      limit 20
    `,
    [taskId, retryBackoffMs],
  );

  return result.rows.map(mapTaskRunRow);
}

async function listUnresolvedFeedback(
  client: DatabaseClient,
  taskId: string,
): Promise<TaskFeedbackSummary[]> {
  const result = await client.query<TaskFeedbackRow>(
    `
      select id, source, severity, body, external_url, created_at
      from feedback_items
      where task_id = $1
        and resolved_at is null
        and source <> 'agent_progress'
      order by created_at desc
      limit 20
    `,
    [taskId],
  );

  return result.rows.map((row) => {
    const record: TaskFeedbackSummary = {
      id: row.id,
      source: row.source,
      severity: row.severity,
      body: row.body,
      createdAt: row.created_at,
    };

    if (row.external_url) {
      record.externalUrl = row.external_url;
    }

    return record;
  });
}

async function listTaskProgress(
  client: DatabaseClient,
  taskId: string,
): Promise<TaskFeedbackSummary[]> {
  const result = await client.query<TaskFeedbackRow>(
    `
      select id, source, severity, body, external_url, created_at
      from feedback_items
      where task_id = $1
        and source = 'agent_progress'
      order by created_at desc
      limit 20
    `,
    [taskId],
  );

  return result.rows.map((row) => {
    const record: TaskFeedbackSummary = {
      id: row.id,
      source: row.source,
      severity: row.severity,
      body: row.body,
      createdAt: row.created_at,
    };

    if (row.external_url) {
      record.externalUrl = row.external_url;
    }

    return record;
  });
}

function mapTaskQueueRow(row: TaskQueueRow): TaskQueueRecord {
  if (!isWorkflowState(row.state)) {
    throw new Error(`Unknown workflow state from database: ${row.state}`);
  }

  const record: TaskQueueRecord = {
    taskId: row.id,
    externalTaskId: row.external_task_id,
    identifier: row.identifier,
    title: row.title,
    state: row.state,
    mode: modeForState(row.state),
    role: roleForState(row.state),
    labels: normalizeLabels(row.labels),
    projectSlug: row.project_slug,
    projectName: row.project_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.priority !== null) {
    record.priority = row.priority;
  }

  if (row.assignee) {
    record.assignee = row.assignee;
  }

  if (row.url) {
    record.url = row.url;
  }

  if (row.repository_slug) {
    record.repositorySlug = row.repository_slug;
  }

  const latestRun = mapTaskRunFromQueueRow(row, "latest");
  if (latestRun) {
    record.latestRun = latestRun;
  }

  const activeRun = mapTaskRunFromQueueRow(row, "active");
  if (activeRun) {
    record.activeRun = activeRun;
  }

  return record;
}

function mapTaskRunFromQueueRow(
  row: TaskQueueRow,
  kind: "latest" | "active",
): TaskRunSummary | undefined {
  const prefix = kind === "latest" ? "latest_run" : "active_run";
  const runId = row[`${prefix}_id` as keyof TaskQueueRow];
  const status = row[`${prefix}_status` as keyof TaskQueueRow];
  const role = row[`${prefix}_role` as keyof TaskQueueRow];
  const createdAt = row[`${prefix}_created_at` as keyof TaskQueueRow];
  const updatedAt = row[`${prefix}_updated_at` as keyof TaskQueueRow];
  if (
    typeof runId !== "string" ||
    typeof status !== "string" ||
    typeof role !== "string" ||
    !(createdAt instanceof Date) ||
    !(updatedAt instanceof Date)
  ) {
    return undefined;
  }

  const run: TaskRunSummary = {
    runId,
    status,
    role: role as AgentRole,
    createdAt,
    updatedAt,
  };
  const attempt = row[`${prefix}_attempt` as keyof TaskQueueRow];
  const leaseOwner = row[`${prefix}_lease_owner` as keyof TaskQueueRow];
  const leaseExpiresAt = row[`${prefix}_lease_expires_at` as keyof TaskQueueRow];
  const heartbeatAt = row[`${prefix}_heartbeat_at` as keyof TaskQueueRow];
  const startedAt = row[`${prefix}_started_at` as keyof TaskQueueRow];
  const finishedAt = row[`${prefix}_finished_at` as keyof TaskQueueRow];
  const resultSummary = row[`${prefix}_result_summary` as keyof TaskQueueRow];
  const failureReason = row[`${prefix}_failure_reason` as keyof TaskQueueRow];
  const retryable = row[`${prefix}_retryable` as keyof TaskQueueRow];
  const retryAfterAt = row[`${prefix}_retry_after_at` as keyof TaskQueueRow];
  const nextState = row[`${prefix}_next_state` as keyof TaskQueueRow];

  if (typeof attempt === "number") {
    run.attempt = attempt;
  }

  if (typeof leaseOwner === "string") {
    run.leaseOwner = leaseOwner;
  }

  if (leaseExpiresAt instanceof Date) {
    run.leaseExpiresAt = leaseExpiresAt;
  }

  if (heartbeatAt instanceof Date) {
    run.heartbeatAt = heartbeatAt;
  }

  if (startedAt instanceof Date) {
    run.startedAt = startedAt;
  }

  if (finishedAt instanceof Date) {
    run.finishedAt = finishedAt;
  }

  if (typeof resultSummary === "string") {
    run.resultSummary = resultSummary;
  }

  if (typeof failureReason === "string") {
    run.failureReason = failureReason;
  }

  if (typeof retryable === "boolean") {
    run.retryable = retryable;
  }

  if (retryAfterAt instanceof Date) {
    run.retryAfterAt = retryAfterAt;
  }

  if (typeof nextState === "string") {
    run.nextState = nextState;
  }

  return run;
}

function mapTaskRunRow(row: TaskRunRow): TaskRunSummary {
  const run: TaskRunSummary = {
    runId: row.id,
    status: row.status,
    role: row.role_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (typeof row.attempt === "number") {
    run.attempt = row.attempt;
  }

  if (row.lease_owner) {
    run.leaseOwner = row.lease_owner;
  }

  if (row.lease_expires_at) {
    run.leaseExpiresAt = row.lease_expires_at;
  }

  if (row.heartbeat_at) {
    run.heartbeatAt = row.heartbeat_at;
  }

  if (row.started_at) {
    run.startedAt = row.started_at;
  }

  if (row.finished_at) {
    run.finishedAt = row.finished_at;
  }

  if (row.result_summary) {
    run.resultSummary = row.result_summary;
  }

  if (row.failure_reason) {
    run.failureReason = row.failure_reason;
  }

  if (typeof row.retryable === "boolean") {
    run.retryable = row.retryable;
  }

  if (row.retry_after_at) {
    run.retryAfterAt = row.retry_after_at;
  }

  if (row.next_state) {
    run.nextState = row.next_state;
  }

  return run;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object" && "name" in item) {
        const name = (item as { name?: unknown }).name;
        return typeof name === "string" ? name : undefined;
      }

      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

function statesForMode(mode?: TaskQueueMode): string[] | null {
  if (!mode || mode === "all") {
    return null;
  }

  if (mode === "agent") {
    return [...automaticStates];
  }

  if (mode === "human") {
    return [...manualGateStates];
  }

  if (mode === "terminal") {
    return [...terminalStates];
  }

  return ["Blocked"];
}

function modeForState(state: WorkflowState): TaskQueueMode {
  if (isAutomaticState(state)) {
    return "agent";
  }

  if (isManualGateState(state)) {
    return "human";
  }

  if (isTerminalState(state)) {
    return "terminal";
  }

  if (state === "Blocked") {
    return "blocked";
  }

  return "all";
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function normalizeRetryBackoffMs(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 5 * 60_000;
  }

  return Math.max(0, Math.trunc(value));
}
