import type { PlaneConfig } from "./config.js";
import {
  PlaneClient,
  PlaneApiError,
  type PlaneAgentConfigOutboxEvent,
  type PlaneListAgentConfigOutboxOptions,
  type PlaneListWorkItemsOptions,
  type PlaneWorkItemComment,
} from "./client.js";
import type { PlaneTaskSyncRecord } from "./mapping.js";
import { mapPlaneWorkItemToTask } from "./mapping.js";

export interface PlaneCommentFeedbackSyncRecord {
  externalTaskId: string;
  body: string;
  externalUrl?: string;
  syncCursor?: string;
}

export interface PlaneTaskAndCommentSyncRecords {
  tasks: PlaneTaskSyncRecord[];
  comments: PlaneCommentFeedbackSyncRecord[];
  warnings: PlaneSyncWarning[];
}

export interface PlaneSyncWarning {
  type: "comment_fetch_failed";
  externalTaskId: string;
  message: string;
}

export interface PlaneSyncOptions {
  syncCursor?: string | Date | null;
  retryAttempts?: number;
  retryDelayMs?: number;
  serverDelta?: boolean;
}

export interface PlanePollingClient {
  listProjectLabels(
    workspaceSlug: string,
    projectId: string,
  ): Promise<{ id: string; name: string }[]>;
  listProjectStates(
    workspaceSlug: string,
    projectId: string,
  ): Promise<{ id: string; name: string }[]>;
  listWorkItems(
    workspaceSlug: string,
    projectId: string,
    options?: PlaneListWorkItemsOptions,
  ): Promise<
    {
      id: string;
      name: string;
      state: string | null;
      labels?: readonly string[];
      priority?: string | null;
      sequence_id?: number | null;
      updated_at?: string | null;
    }[]
  >;
  listWorkItemComments(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
  ): Promise<PlaneWorkItemComment[]>;
}

export interface PlaneAgentConfigOutboxClient {
  listAgentConfigOutbox(
    workspaceSlug: string,
    options?: PlaneListAgentConfigOutboxOptions,
  ): Promise<PlaneAgentConfigOutboxEvent[]>;
}

export async function fetchPlaneTaskSyncRecords(
  config: PlaneConfig,
  client: PlanePollingClient = new PlaneClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }),
  options: PlaneSyncOptions = {},
): Promise<PlaneTaskSyncRecord[]> {
  return (await fetchPlaneTaskAndCommentSyncRecords(config, client, options)).tasks;
}

export async function fetchPlaneTaskAndCommentSyncRecords(
  config: PlaneConfig,
  client: PlanePollingClient = new PlaneClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }),
  options: PlaneSyncOptions = {},
): Promise<PlaneTaskAndCommentSyncRecords> {
  const retryPolicy = normalizeRetryPolicy(options);
  const cursor = normalizeCursor(options.syncCursor);
  const serverUpdatedAfter =
    options.serverDelta === true && cursor ? cursor.toISOString() : undefined;
  const [labels, states, workItemLists] = await Promise.all([
    withRetry(() => client.listProjectLabels(config.workspaceSlug, config.projectId), retryPolicy),
    withRetry(() => client.listProjectStates(config.workspaceSlug, config.projectId), retryPolicy),
    listWorkItemsForTaskAndCommentSync(config, client, retryPolicy, serverUpdatedAfter),
  ]);

  const labelsById = new Map(labels.map((label) => [label.id, label]));
  const statesById = new Map(states.map((state) => [state.id, state]));

  const tasks = workItemLists.taskWorkItems
    .filter((workItem) => isNewerThanCursor(workItem.updated_at, cursor))
    .map((workItem) =>
      mapPlaneWorkItemToTask({
        workItem,
        labelsById,
        statesById,
        projectIdentifier: config.projectSlug.toUpperCase(),
        baseUrl: config.baseUrl,
        workspaceSlug: config.workspaceSlug,
        projectId: config.projectId,
      }),
    );

  const commentResults = await Promise.all(
    workItemLists.commentWorkItems.map(async (workItem) =>
      fetchWorkItemCommentRecords(config, client, workItem.id, retryPolicy),
    ),
  );
  const comments = commentResults.flatMap((result) => result.comments);
  const warnings = commentResults.flatMap((result) => result.warnings);

  return {
    tasks,
    comments: comments.filter((comment) => isNewerThanCursor(comment.syncCursor, cursor)),
    warnings,
  };
}

export async function fetchPlaneAgentConfigOutboxEvents(
  config: Pick<PlaneConfig, "baseUrl" | "apiKey" | "workspaceSlug">,
  client: PlaneAgentConfigOutboxClient = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  }),
  options: PlaneListAgentConfigOutboxOptions &
    Pick<PlaneSyncOptions, "retryAttempts" | "retryDelayMs"> = {},
): Promise<PlaneAgentConfigOutboxEvent[]> {
  const retryPolicy = normalizeRetryPolicy(options);
  return await withRetry(
    () =>
      client.listAgentConfigOutbox(config.workspaceSlug, {
        ...(options.afterId !== undefined ? { afterId: options.afterId } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      }),
    retryPolicy,
  );
}

interface PlaneWorkItemForSync {
  id: string;
  name: string;
  state: string | null;
  labels?: readonly string[];
  priority?: string | null;
  sequence_id?: number | null;
  updated_at?: string | null;
}

async function listWorkItemsForTaskAndCommentSync(
  config: PlaneConfig,
  client: PlanePollingClient,
  retryPolicy: RetryPolicy,
  serverUpdatedAfter: string | undefined,
): Promise<{
  taskWorkItems: PlaneWorkItemForSync[];
  commentWorkItems: PlaneWorkItemForSync[];
}> {
  if (!serverUpdatedAfter) {
    const workItems = await withRetry(
      () => client.listWorkItems(config.workspaceSlug, config.projectId),
      retryPolicy,
    );
    return {
      taskWorkItems: workItems,
      commentWorkItems: workItems,
    };
  }

  try {
    const taskWorkItems = await withRetry(
      () =>
        client.listWorkItems(config.workspaceSlug, config.projectId, {
          updatedAfter: serverUpdatedAfter,
        }),
      retryPolicy,
    );
    const commentWorkItems = await withRetry(
      () => client.listWorkItems(config.workspaceSlug, config.projectId),
      retryPolicy,
    );
    return {
      taskWorkItems,
      commentWorkItems,
    };
  } catch (error) {
    if (!isLikelyUnsupportedServerDeltaError(error)) {
      throw error;
    }

    const workItems = await withRetry(
      () => client.listWorkItems(config.workspaceSlug, config.projectId),
      retryPolicy,
    );
    return {
      taskWorkItems: workItems,
      commentWorkItems: workItems,
    };
  }
}

async function fetchWorkItemCommentRecords(
  config: PlaneConfig,
  client: PlanePollingClient,
  workItemId: string,
  retryPolicy: RetryPolicy,
): Promise<{
  comments: PlaneCommentFeedbackSyncRecord[];
  warnings: PlaneSyncWarning[];
}> {
  try {
    const workItemComments = await withRetry(
      () => client.listWorkItemComments(config.workspaceSlug, config.projectId, workItemId),
      retryPolicy,
    );

    return {
      comments: workItemComments
        .map((comment) => mapPlaneCommentToFeedback(config, workItemId, comment))
        .filter((record): record is PlaneCommentFeedbackSyncRecord => Boolean(record)),
      warnings: [],
    };
  } catch (error) {
    return {
      comments: [],
      warnings: [
        {
          type: "comment_fetch_failed",
          externalTaskId: workItemId,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function isLikelyUnsupportedServerDeltaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return (
    normalized.includes("400") ||
    normalized.includes("unsupported") ||
    normalized.includes("unknown") ||
    normalized.includes("invalid") ||
    normalized.includes("updated_after")
  );
}

interface RetryPolicy {
  attempts: number;
  delayMs: number;
}

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

async function withRetry<T>(operation: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryablePlaneSyncError(error)) {
        throw error;
      }

      if (attempt >= policy.attempts) {
        continue;
      }

      const retryDelayMs = getRetryDelayMs(error, policy.delayMs);
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function normalizeRetryPolicy(options: PlaneSyncOptions): RetryPolicy {
  return {
    attempts: Math.max(1, Math.trunc(options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS)),
    delayMs: Math.max(0, Math.trunc(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)),
  };
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getRetryDelayMs(error: unknown, fallbackDelayMs: number): number {
  if (error instanceof PlaneApiError && error.retryAfterMs !== undefined) {
    return Math.max(0, error.retryAfterMs);
  }

  return fallbackDelayMs;
}

function isRetryablePlaneSyncError(error: unknown): boolean {
  const status = getPlaneApiErrorStatus(error);
  if (status === undefined) {
    return true;
  }

  return status === 408 || status === 429 || status >= 500;
}

function getPlaneApiErrorStatus(error: unknown): number | undefined {
  if (error instanceof PlaneApiError) {
    return error.status;
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = /^Plane API (\d{3})\b/.exec(message);
  if (!match) {
    return undefined;
  }

  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
}

function mapPlaneCommentToFeedback(
  config: PlaneConfig,
  workItemId: string,
  comment: PlaneWorkItemComment,
): PlaneCommentFeedbackSyncRecord | undefined {
  const body =
    comment.comment_stripped?.trim() || comment.comment_html?.trim() || comment.body?.trim();

  if (!body) {
    return undefined;
  }

  const record: PlaneCommentFeedbackSyncRecord = {
    externalTaskId: workItemId,
    body,
    externalUrl: buildCommentUrl(config, workItemId, comment.id),
  };

  const syncCursor = comment.updated_at ?? comment.created_at;
  if (syncCursor) {
    record.syncCursor = syncCursor;
  }

  return record;
}

function buildCommentUrl(config: PlaneConfig, workItemId: string, commentId: string): string {
  return `${config.baseUrl}/workspace/${config.workspaceSlug}/projects/${config.projectId}/issues/${workItemId}#comment-${commentId}`;
}

function normalizeCursor(value: string | Date | null | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isNewerThanCursor(value: string | null | undefined, cursor: Date | undefined): boolean {
  if (!cursor) {
    return true;
  }

  if (!value) {
    return true;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return true;
  }

  return date > cursor;
}
