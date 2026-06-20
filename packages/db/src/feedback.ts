import { canTransition, isWorkflowState, type WorkflowState } from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";

export interface PlaneCommentFeedbackInput {
  externalTaskId: string;
  body: string;
  externalUrl?: string;
}

export interface PlaneCommentFeedbackResult {
  inserted: boolean;
  taskId?: string;
  reason?: string;
}

export interface TaskReworkInput {
  taskId: string;
  body: string;
  source: "human" | "code_review" | "pr_review" | "agent" | "plane_comment";
  severity?: "info" | "minor" | "major" | "blocker";
  runId?: string;
  externalUrl?: string;
}

export interface TaskReworkResult {
  updated: boolean;
  taskId?: string;
  previousState?: WorkflowState;
  nextState?: "Development";
  feedbackId?: string;
  reason?: "task_not_found" | "invalid_state" | "transition_not_allowed";
}

export interface TaskProgressInput {
  taskId: string;
  body: string;
  actor?: string;
  runId?: string;
  externalUrl?: string;
}

export interface TaskProgressResult {
  inserted: boolean;
  taskId?: string;
  progressId?: string;
  reason?: "task_not_found";
}

export interface DispatchPolicyBlockedTaskInput {
  taskId: string;
  identifier: string;
  estimatedCostUsd?: number | null;
  maxEstimatedCostUsdPerRun: number;
}

export interface DispatchPolicyBlockedTaskResult {
  blocked: number;
  taskIds: string[];
}

export interface TaskFeedbackInput {
  taskId: string;
  body: string;
  source: "human" | "code_review" | "pr_review" | "agent" | "plane_comment";
  severity?: "info" | "minor" | "major" | "blocker";
  runId?: string;
  externalUrl?: string;
}

export interface TaskFeedbackResult {
  inserted: boolean;
  taskId?: string;
  feedbackId?: string;
  reason?: "task_not_found" | "duplicate";
}

interface TaskIdRow {
  id: string;
}

interface FeedbackInsertRow {
  task_id: string;
}

interface ProgressInsertRow {
  task_id: string;
  progress_id: string;
}

interface BlockedTaskRow {
  task_id: string;
}

interface TaskFeedbackInsertRow {
  task_id: string;
  feedback_id: string;
}

interface TaskStateRow {
  id: string;
  state: string;
}

interface ReworkRow {
  task_id: string;
  previous_state: string;
  feedback_id: string;
}

export async function insertPlaneCommentFeedback(
  client: DatabaseClient,
  input: PlaneCommentFeedbackInput,
): Promise<PlaneCommentFeedbackResult> {
  const taskId = await findTaskIdByExternalTaskId(client, input.externalTaskId);
  if (!taskId) {
    return {
      inserted: false,
      reason: "task_not_found",
    };
  }

  const result = await client.query<FeedbackInsertRow>(
    `
      with inserted as (
        insert into feedback_items (
          id,
          task_id,
          source,
          severity,
          body,
          external_url
        )
        select gen_random_uuid(), $1, 'plane_comment', 'info', $2, $3
        where not exists (
          select 1
          from feedback_items
          where task_id = $1
            and source = 'plane_comment'
            and body = $2
            and coalesce(external_url, '') = coalesce($3, '')
        )
        returning task_id
      )
      select task_id from inserted
    `,
    [taskId, input.body, input.externalUrl ?? null],
  );

  if (!result.rows[0]) {
    return {
      inserted: false,
      taskId,
      reason: "duplicate",
    };
  }

  return {
    inserted: true,
    taskId,
  };
}

export async function requestTaskRework(
  client: DatabaseClient,
  input: TaskReworkInput,
): Promise<TaskReworkResult> {
  const task = await fetchTaskState(client, input.taskId);
  if (!task) {
    return {
      updated: false,
      reason: "task_not_found",
    };
  }

  if (!isWorkflowState(task.state)) {
    return {
      updated: false,
      taskId: task.id,
      reason: "invalid_state",
    };
  }

  if (!canTransition(task.state, "Development")) {
    return {
      updated: false,
      taskId: task.id,
      previousState: task.state,
      reason: "transition_not_allowed",
    };
  }

  const result = await client.query<ReworkRow>(
    `
      with feedback as (
        insert into feedback_items (
          id,
          task_id,
          run_id,
          source,
          severity,
          body,
          external_url,
          created_at
        )
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
        returning id, task_id
      ),
      previous as (
        select id, state
        from tasks
        where id = $1
      ),
      updated as (
        update tasks
        set state = 'Development', updated_at = now()
        from previous
        where tasks.id = previous.id
        returning tasks.id
      ),
      event as (
        insert into run_events (id, run_id, event_type, message, payload, created_at)
        select
          gen_random_uuid(),
          $2::uuid,
          'rework_requested',
          'Task returned to Development with actionable feedback.',
          jsonb_build_object(
            'taskId', $1::text,
            'previousState', previous.state,
            'nextState', 'Development',
            'feedbackId', feedback.id,
            'source', $3::text,
            'severity', $4::text
          ),
          now()
        from feedback, previous
        where $2::uuid is not null
        returning run_id
      )
      select
        feedback.task_id,
        previous.state as previous_state,
        feedback.id as feedback_id
      from feedback, previous, updated
    `,
    [
      input.taskId,
      input.runId ?? null,
      input.source,
      input.severity ?? "major",
      input.body,
      input.externalUrl ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row || !isWorkflowState(row.previous_state)) {
    return {
      updated: false,
      taskId: input.taskId,
      reason: "invalid_state",
    };
  }

  return {
    updated: true,
    taskId: row.task_id,
    previousState: row.previous_state,
    nextState: "Development",
    feedbackId: row.feedback_id,
  };
}

export async function recordTaskProgress(
  client: DatabaseClient,
  input: TaskProgressInput,
): Promise<TaskProgressResult> {
  const result = await client.query<ProgressInsertRow>(
    `
      with task as (
        select id
        from tasks
        where id = $1
        limit 1
      ),
      inserted as (
        insert into feedback_items (
          id,
          task_id,
          run_id,
          source,
          severity,
          body,
          external_url,
          created_at
        )
        select
          gen_random_uuid(),
          task.id,
          $2::uuid,
          'agent_progress',
          'info',
          $3,
          $4,
          now()
        from task
        returning task_id, id as progress_id
      )
      select task_id, progress_id
      from inserted
    `,
    [input.taskId, input.runId ?? null, input.body, input.externalUrl ?? null],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      inserted: false,
      reason: "task_not_found",
    };
  }

  return {
    inserted: true,
    taskId: row.task_id,
    progressId: row.progress_id,
  };
}

export async function blockTasksForDispatchPolicy(
  client: DatabaseClient,
  inputs: readonly DispatchPolicyBlockedTaskInput[],
): Promise<DispatchPolicyBlockedTaskResult> {
  if (inputs.length === 0) {
    return {
      blocked: 0,
      taskIds: [],
    };
  }

  const payload = JSON.stringify(
    inputs.map((input) => ({
      taskId: input.taskId,
      identifier: input.identifier,
      estimatedCostUsd: input.estimatedCostUsd ?? null,
      maxEstimatedCostUsdPerRun: input.maxEstimatedCostUsdPerRun,
    })),
  );

  const result = await client.query<BlockedTaskRow>(
    `
      with input as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          "taskId" uuid,
          "identifier" text,
          "estimatedCostUsd" numeric,
          "maxEstimatedCostUsdPerRun" numeric
        )
      ),
      updated as (
        update tasks
        set state = 'Blocked', updated_at = now()
        from input
        where tasks.id = input."taskId"
          and tasks.state <> 'Blocked'
          and tasks.state not in ('Done', 'Canceled', 'Duplicate')
        returning
          tasks.id,
          input."identifier",
          input."estimatedCostUsd",
          input."maxEstimatedCostUsdPerRun"
      ),
      progress as (
        insert into feedback_items (
          id,
          task_id,
          source,
          severity,
          body,
          created_at
        )
        select
          gen_random_uuid(),
          updated.id,
          'agent_progress',
          'blocker',
          format(
            'Agent Status: Blocked. %s estimated cost $%s exceeds per-run budget $%s.',
            updated."identifier",
            coalesce(updated."estimatedCostUsd"::text, 'unknown'),
            updated."maxEstimatedCostUsdPerRun"::text
          ),
          now()
        from updated
        returning task_id
      )
      select task_id
      from progress
    `,
    [payload],
  );

  return {
    blocked: result.rows.length,
    taskIds: result.rows.map((row) => row.task_id),
  };
}

export async function recordTaskFeedback(
  client: DatabaseClient,
  input: TaskFeedbackInput,
): Promise<TaskFeedbackResult> {
  const result = await client.query<TaskFeedbackInsertRow>(
    `
      with task as (
        select id
        from tasks
        where id = $1
        limit 1
      ),
      inserted as (
        insert into feedback_items (
          id,
          task_id,
          run_id,
          source,
          severity,
          body,
          external_url,
          created_at
        )
        select
          gen_random_uuid(),
          task.id,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          now()
        from task
        where not exists (
          select 1
          from feedback_items existing
          where existing.task_id = task.id
            and existing.source = $3
            and existing.body = $5
            and coalesce(existing.external_url, '') = coalesce($6, '')
        )
        returning task_id, id as feedback_id
      )
      select task_id, feedback_id
      from inserted
    `,
    [
      input.taskId,
      input.runId ?? null,
      input.source,
      input.severity ?? "major",
      input.body,
      input.externalUrl ?? null,
    ],
  );

  const row = result.rows[0];
  if (row) {
    return {
      inserted: true,
      taskId: row.task_id,
      feedbackId: row.feedback_id,
    };
  }

  const task = await fetchTaskState(client, input.taskId);
  if (!task) {
    return {
      inserted: false,
      reason: "task_not_found",
    };
  }

  return {
    inserted: false,
    taskId: task.id,
    reason: "duplicate",
  };
}

async function findTaskIdByExternalTaskId(
  client: DatabaseClient,
  externalTaskId: string,
): Promise<string | undefined> {
  const result = await client.query<TaskIdRow>(
    `
      select id
      from tasks
      where external_task_id = $1
      order by updated_at desc
      limit 1
    `,
    [externalTaskId],
  );

  return result.rows[0]?.id;
}

async function fetchTaskState(
  client: DatabaseClient,
  taskId: string,
): Promise<TaskStateRow | undefined> {
  const result = await client.query<TaskStateRow>(
    `
      select id, state
      from tasks
      where id = $1
      limit 1
    `,
    [taskId],
  );

  return result.rows[0];
}
