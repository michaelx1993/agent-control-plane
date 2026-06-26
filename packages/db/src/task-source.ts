import {
  automaticStates,
  isWorkflowState,
  manualGateStates,
  type WorkflowState,
} from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";

export interface TaskSourceAuditOptions {
  executionProfile?: TaskSourceAuditProfile | string;
  planeBaseUrl?: string;
  projectSlug?: string;
  limit?: number;
  requireSample?: boolean;
  requirePlaneUrl?: boolean;
  requireRepositoryRouting?: boolean;
  requireRunEvidence?: boolean;
  requireRunEventEvidence?: boolean;
  requireProgressEvidence?: boolean;
  requirePromptReleaseEvidence?: boolean;
  requireWorkspaceEvidence?: boolean;
  requireConversationEvidence?: boolean;
  requireTraceEvidence?: boolean;
  includeRunEvidenceTasks?: boolean;
}

export type TaskSourceAuditProfile =
  | "codex-cli"
  | "external"
  | "legacy-openhands"
  | "openhands"
  | "openhands-cloud"
  | "openhands-langfuse";

export interface TaskSourceAuditRecord {
  taskId: string;
  identifier: string;
  title: string;
  state: WorkflowState;
  url?: string;
  projectSlug: string;
  repositoryId?: string;
  repositorySlug?: string;
  latestRunId?: string;
  latestRunStatus?: string;
  latestRunEventCount: number;
  progressItemCount: number;
  promptReleaseCount: number;
  workspaceCount: number;
  conversationUrl?: string;
  traceUrl?: string;
  updatedAt: Date;
}

export type TaskSourceAuditViolationType =
  | "missing_url"
  | "linear_url"
  | "non_plane_url"
  | "missing_repository_routing"
  | "missing_run_evidence"
  | "missing_run_event_evidence"
  | "missing_progress_evidence"
  | "missing_prompt_release_evidence"
  | "missing_workspace_evidence"
  | "missing_conversation_evidence"
  | "missing_trace_evidence";

export interface TaskSourceAuditViolation {
  type: TaskSourceAuditViolationType;
  identifier: string;
  message: string;
  url?: string;
}

export interface TaskSourceAuditResult {
  checked: number;
  planeUrlCount: number;
  linearUrlCount: number;
  routedCount: number;
  runEvidenceCount: number;
  runEventEvidenceCount: number;
  progressEvidenceCount: number;
  promptReleaseEvidenceCount: number;
  workspaceEvidenceCount: number;
  conversationEvidenceCount: number;
  traceEvidenceCount: number;
  violations: TaskSourceAuditViolation[];
}

interface TaskSourceAuditRow {
  id: string;
  identifier: string;
  title: string;
  state: string;
  url: string | null;
  project_slug: string;
  repository_id: string | null;
  repository_slug: string | null;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_event_count: string | number | null;
  progress_item_count: string | number | null;
  prompt_release_count: string | number | null;
  workspace_count: string | number | null;
  conversation_url: string | null;
  trace_url: string | null;
  updated_at: Date;
}

const DEFAULT_LIMIT = 50;

export async function auditTaskSources(
  client: DatabaseClient,
  options: TaskSourceAuditOptions = {},
): Promise<TaskSourceAuditResult> {
  const records = await fetchTaskSourceAuditRecords(client, options);
  const normalizedPlaneBaseUrl = normalizeBaseUrl(options.planeBaseUrl);
  const requirements = resolveAuditRequirements(options);

  const violations: TaskSourceAuditViolation[] = [];

  if (requirements.requireSample && records.length === 0) {
    violations.push({
      type: "missing_run_evidence",
      identifier: "task-source-smoke",
      message: "No automatic non-terminal tasks were available to audit",
    });
  }

  for (const record of records) {
    if (requirements.requirePlaneUrl && !record.url) {
      violations.push({
        type: "missing_url",
        identifier: record.identifier,
        message: "Task has no external URL; expected a Plane work item URL",
      });
    }

    if (record.url && isLinearUrl(record.url)) {
      violations.push({
        type: "linear_url",
        identifier: record.identifier,
        message: "Task still points to Linear; Linear must be archive-only after cutover",
        url: record.url,
      });
    }

    if (
      requirements.requirePlaneUrl &&
      record.url &&
      normalizedPlaneBaseUrl &&
      !isPlaneUrl(record.url, normalizedPlaneBaseUrl)
    ) {
      violations.push({
        type: "non_plane_url",
        identifier: record.identifier,
        message: `Task URL is not under Plane base URL ${normalizedPlaneBaseUrl}`,
        url: record.url,
      });
    }

    if (requirements.requireRepositoryRouting && !record.repositoryId) {
      violations.push({
        type: "missing_repository_routing",
        identifier: record.identifier,
        message: "Task is missing repository routing; add repo:<slug> label or repo field",
      });
    }

    if (requirements.requireRunEvidence && !record.latestRunId) {
      violations.push({
        type: "missing_run_evidence",
        identifier: record.identifier,
        message: "Task has no Control Plane run evidence",
      });
    }

    if (requirements.requireRunEventEvidence && record.latestRunEventCount <= 0) {
      violations.push({
        type: "missing_run_event_evidence",
        identifier: record.identifier,
        message: "Task has no Codex/run event evidence",
      });
    }

    if (requirements.requireProgressEvidence && record.progressItemCount <= 0) {
      violations.push({
        type: "missing_progress_evidence",
        identifier: record.identifier,
        message: "Task has no Progress/Workpad evidence",
      });
    }

    if (requirements.requirePromptReleaseEvidence && record.promptReleaseCount <= 0) {
      violations.push({
        type: "missing_prompt_release_evidence",
        identifier: record.identifier,
        message: "Task has no immutable prompt release evidence",
      });
    }

    if (requirements.requireWorkspaceEvidence && record.workspaceCount <= 0) {
      violations.push({
        type: "missing_workspace_evidence",
        identifier: record.identifier,
        message: "Task has no workspace evidence",
      });
    }

    if (requirements.requireConversationEvidence && !record.conversationUrl) {
      violations.push({
        type: "missing_conversation_evidence",
        identifier: record.identifier,
        message: "Task has no OpenHands conversation evidence",
      });
    }

    if (requirements.requireTraceEvidence && !record.traceUrl) {
      violations.push({
        type: "missing_trace_evidence",
        identifier: record.identifier,
        message: "Task has no Langfuse trace evidence",
      });
    }
  }

  return {
    checked: records.length,
    planeUrlCount: records.filter((record) =>
      record.url && normalizedPlaneBaseUrl ? isPlaneUrl(record.url, normalizedPlaneBaseUrl) : false,
    ).length,
    linearUrlCount: records.filter((record) => record.url && isLinearUrl(record.url)).length,
    routedCount: records.filter((record) => Boolean(record.repositoryId)).length,
    runEvidenceCount: records.filter((record) => Boolean(record.latestRunId)).length,
    runEventEvidenceCount: records.filter((record) => record.latestRunEventCount > 0).length,
    progressEvidenceCount: records.filter((record) => record.progressItemCount > 0).length,
    promptReleaseEvidenceCount: records.filter((record) => record.promptReleaseCount > 0).length,
    workspaceEvidenceCount: records.filter((record) => record.workspaceCount > 0).length,
    conversationEvidenceCount: records.filter((record) => Boolean(record.conversationUrl)).length,
    traceEvidenceCount: records.filter((record) => Boolean(record.traceUrl)).length,
    violations,
  };
}

export async function fetchTaskSourceAuditRecords(
  client: DatabaseClient,
  options: TaskSourceAuditOptions = {},
): Promise<TaskSourceAuditRecord[]> {
  const states = automaticStates.map((state) => state);
  const runEvidenceStates = manualGateStates.map((state) => state);
  const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);
  const includeRunEvidenceTasks = options.includeRunEvidenceTasks ?? true;
  const params: unknown[] = [states, limit, includeRunEvidenceTasks, runEvidenceStates];
  const projectFilter = options.projectSlug?.trim();
  const projectClause = projectFilter ? "and projects.slug = $5" : "";
  if (projectFilter) {
    params.push(projectFilter);
  }

  const result = await client.query<TaskSourceAuditRow>(
    `
      select
        tasks.id,
        tasks.identifier,
        tasks.title,
        tasks.state,
        tasks.url,
        projects.slug as project_slug,
        tasks.repository_id,
        repositories.slug as repository_slug,
        latest_run.id as latest_run_id,
        latest_run.status as latest_run_status,
        coalesce(latest_run_events.run_event_count, 0) as latest_run_event_count,
        coalesce(progress_items.progress_item_count, 0) as progress_item_count,
        coalesce(prompt_releases.prompt_release_count, 0) as prompt_release_count,
        coalesce(workspaces.workspace_count, 0) as workspace_count,
        conversation_refs.ui_url as conversation_url,
        trace_refs.ui_url as trace_url,
        tasks.updated_at
      from tasks
      join projects on projects.id = tasks.project_id
      left join repositories on repositories.id = tasks.repository_id
      left join lateral (
        select id, status, prompt_release_id
        from runs
        where runs.task_id = tasks.id
        order by runs.created_at desc
        limit 1
      ) latest_run on true
      left join lateral (
        select count(*)::int as run_event_count
        from run_events
        where run_events.run_id = latest_run.id
      ) latest_run_events on true
      left join lateral (
        select count(*)::int as progress_item_count
        from feedback_items
        where feedback_items.task_id = tasks.id
          and feedback_items.source = 'agent_progress'
      ) progress_items on true
      left join lateral (
        select count(*)::int as prompt_release_count
        from prompt_releases
        where prompt_releases.id = latest_run.prompt_release_id
      ) prompt_releases on true
      left join lateral (
        select count(*)::int as workspace_count
        from workspaces
        where workspaces.run_id = latest_run.id
          and workspaces.status in ('ready', 'cleaned')
      ) workspaces on true
      left join lateral (
        select ui_url
        from conversation_refs
        where conversation_refs.run_id = latest_run.id
        order by created_at desc
        limit 1
      ) conversation_refs on true
      left join lateral (
        select ui_url
        from trace_refs
        where trace_refs.run_id = latest_run.id
        order by created_at desc
        limit 1
      ) trace_refs on true
      where (
          tasks.state = any($1::text[])
          or ($3::boolean and tasks.state = any($4::text[]) and latest_run.id is not null)
        )
        ${projectClause}
      order by tasks.updated_at desc
      limit $2
    `,
    params,
  );

  return result.rows.map(mapAuditRow);
}

function mapAuditRow(row: TaskSourceAuditRow): TaskSourceAuditRecord {
  if (!isWorkflowState(row.state)) {
    throw new Error(`Unknown workflow state from database: ${row.state}`);
  }

  const record: TaskSourceAuditRecord = {
    taskId: row.id,
    identifier: row.identifier,
    title: row.title,
    state: row.state,
    projectSlug: row.project_slug,
    latestRunEventCount: numberFromPg(row.latest_run_event_count),
    progressItemCount: numberFromPg(row.progress_item_count),
    promptReleaseCount: numberFromPg(row.prompt_release_count),
    workspaceCount: numberFromPg(row.workspace_count),
    updatedAt: row.updated_at,
  };

  if (row.url) {
    record.url = row.url;
  }
  if (row.repository_id) {
    record.repositoryId = row.repository_id;
  }
  if (row.repository_slug) {
    record.repositorySlug = row.repository_slug;
  }
  if (row.latest_run_id) {
    record.latestRunId = row.latest_run_id;
  }
  if (row.latest_run_status) {
    record.latestRunStatus = row.latest_run_status;
  }
  if (row.conversation_url) {
    record.conversationUrl = row.conversation_url;
  }
  if (row.trace_url) {
    record.traceUrl = row.trace_url;
  }

  return record;
}

interface ResolvedTaskSourceAuditRequirements {
  requireSample: boolean;
  requirePlaneUrl: boolean;
  requireRepositoryRouting: boolean;
  requireRunEvidence: boolean;
  requireRunEventEvidence: boolean;
  requireProgressEvidence: boolean;
  requirePromptReleaseEvidence: boolean;
  requireWorkspaceEvidence: boolean;
  requireConversationEvidence: boolean;
  requireTraceEvidence: boolean;
}

function resolveAuditRequirements(
  options: TaskSourceAuditOptions,
): ResolvedTaskSourceAuditRequirements {
  const profile = normalizeExecutionProfile(options.executionProfile);
  const openHandsProfile = isOpenHandsProfile(profile);

  return {
    requireSample: options.requireSample ?? true,
    requirePlaneUrl: options.requirePlaneUrl ?? true,
    requireRepositoryRouting: options.requireRepositoryRouting ?? true,
    requireRunEvidence: options.requireRunEvidence ?? true,
    requireRunEventEvidence: options.requireRunEventEvidence ?? !openHandsProfile,
    requireProgressEvidence: options.requireProgressEvidence ?? !openHandsProfile,
    requirePromptReleaseEvidence: options.requirePromptReleaseEvidence ?? !openHandsProfile,
    requireWorkspaceEvidence: options.requireWorkspaceEvidence ?? !openHandsProfile,
    requireConversationEvidence: options.requireConversationEvidence ?? openHandsProfile,
    requireTraceEvidence: options.requireTraceEvidence ?? openHandsProfile,
  };
}

function normalizeExecutionProfile(value: string | undefined): TaskSourceAuditProfile {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "external" ||
    normalized === "legacy-openhands" ||
    normalized === "openhands" ||
    normalized === "openhands-cloud" ||
    normalized === "openhands-langfuse"
  ) {
    return normalized;
  }

  return "codex-cli";
}

function isOpenHandsProfile(profile: TaskSourceAuditProfile): boolean {
  return (
    profile === "legacy-openhands" ||
    profile === "openhands" ||
    profile === "openhands-cloud" ||
    profile === "openhands-langfuse"
  );
}

function numberFromPg(value: string | number | null): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isLinearUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("linear://") || normalized.includes("linear.app/");
}

function isPlaneUrl(value: string, normalizedPlaneBaseUrl: string): boolean {
  return value.trim().toLowerCase().startsWith(normalizedPlaneBaseUrl);
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/\/+$/, "").toLowerCase();
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 500);
}
