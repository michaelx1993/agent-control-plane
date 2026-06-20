import { isWorkflowState, type WorkflowState } from "@agent-control-plane/core";
import type { CreatedPlaneWorkItem, PlaneClient, PlaneLabel, PlaneState } from "./client.js";
import type { PlaneConfig } from "./config.js";

export interface LinearIssueExport {
  id?: unknown;
  identifier?: unknown;
  title?: unknown;
  description?: unknown;
  url?: unknown;
  priority?: unknown;
  state?: unknown;
  labels?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
}

export interface LinearMigrationIssue {
  externalTaskId: string;
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  priority: string | null;
  state: WorkflowState;
  labels: string[];
  syncCursor?: string;
}

export interface PlaneMigrationCandidate {
  issue: LinearMigrationIssue;
  stateId?: string;
  labelIds: string[];
  missingLabels: string[];
  descriptionHtml: string;
}

export interface PlaneMigrationPlan {
  candidates: PlaneMigrationCandidate[];
  skipped: LinearMigrationSkippedIssue[];
}

export interface LinearMigrationSkippedIssue {
  identifier: string;
  reason: string;
}

export interface RunLinearMigrationInput {
  config: PlaneConfig;
  exportJson: unknown;
  apply: boolean;
  includeTerminal?: boolean;
  client: Pick<PlaneClient, "listProjectLabels" | "listProjectStates" | "createWorkItem">;
}

export interface RunLinearMigrationResult {
  apply: boolean;
  planned: number;
  created: number;
  skipped: LinearMigrationSkippedIssue[];
  candidates: PlaneMigrationCandidate[];
  createdWorkItems: CreatedPlaneWorkItem[];
}

const terminalStates = new Set<WorkflowState>(["Done", "Canceled", "Duplicate"]);

const priorityByNumber = new Map<number, string>([
  [0, "none"],
  [1, "urgent"],
  [2, "high"],
  [3, "medium"],
  [4, "low"],
]);

export function parseLinearExport(exportJson: unknown): LinearMigrationIssue[] {
  const rawIssues = unwrapLinearIssues(exportJson);

  return rawIssues.map((raw, index) => parseLinearIssue(raw, index));
}

export async function buildLinearToPlaneMigrationPlan(
  config: PlaneConfig,
  exportJson: unknown,
  client: Pick<PlaneClient, "listProjectLabels" | "listProjectStates">,
  options: { includeTerminal?: boolean } = {},
): Promise<PlaneMigrationPlan> {
  const [planeLabels, planeStates] = await Promise.all([
    client.listProjectLabels(config.workspaceSlug, config.projectId),
    client.listProjectStates(config.workspaceSlug, config.projectId),
  ]);

  const labelsByName = new Map(planeLabels.map((label) => [normalizeName(label.name), label]));
  const statesByName = new Map(planeStates.map((state) => [normalizeName(state.name), state]));
  const candidates: PlaneMigrationCandidate[] = [];
  const skipped: LinearMigrationSkippedIssue[] = [];

  for (const issue of parseLinearExport(exportJson)) {
    if (!options.includeTerminal && terminalStates.has(issue.state)) {
      skipped.push({
        identifier: issue.identifier,
        reason: `terminal state ${issue.state}`,
      });
      continue;
    }

    const state = statesByName.get(normalizeName(issue.state));
    const resolvedLabels = resolvePlaneLabelIds(issue.labels, labelsByName);

    const candidate: PlaneMigrationCandidate = {
      issue,
      labelIds: resolvedLabels.labelIds,
      missingLabels: resolvedLabels.missingLabels,
      descriptionHtml: renderMigratedIssueDescription(issue),
    };

    if (state) {
      candidate.stateId = state.id;
    }

    candidates.push(candidate);
  }

  return { candidates, skipped };
}

export async function runLinearToPlaneMigration(
  input: RunLinearMigrationInput,
): Promise<RunLinearMigrationResult> {
  const options: { includeTerminal?: boolean } = {};
  if (input.includeTerminal !== undefined) {
    options.includeTerminal = input.includeTerminal;
  }

  const plan = await buildLinearToPlaneMigrationPlan(
    input.config,
    input.exportJson,
    input.client,
    options,
  );

  const createdWorkItems: CreatedPlaneWorkItem[] = [];

  if (input.apply) {
    for (const candidate of plan.candidates) {
      const createInput = {
        name: candidate.issue.title,
        descriptionHtml: candidate.descriptionHtml,
        labelIds: candidate.labelIds,
        priority: candidate.issue.priority,
      };

      if (candidate.stateId) {
        Object.assign(createInput, { stateId: candidate.stateId });
      }

      const created = await input.client.createWorkItem(
        input.config.workspaceSlug,
        input.config.projectId,
        createInput,
      );
      createdWorkItems.push(created);
    }
  }

  return {
    apply: input.apply,
    planned: plan.candidates.length,
    created: createdWorkItems.length,
    skipped: plan.skipped,
    candidates: plan.candidates,
    createdWorkItems,
  };
}

function unwrapLinearIssues(exportJson: unknown): unknown[] {
  if (Array.isArray(exportJson)) {
    return exportJson;
  }

  if (!isObject(exportJson)) {
    throw new Error("Linear export must be a JSON array or object containing issues.");
  }

  if (Array.isArray(exportJson.issues)) {
    return exportJson.issues;
  }

  if (isObject(exportJson.data) && Array.isArray(exportJson.data.issues)) {
    return exportJson.data.issues;
  }

  if (isObject(exportJson.data) && isObject(exportJson.data.issues)) {
    const nodes = exportJson.data.issues.nodes;
    if (Array.isArray(nodes)) {
      return nodes;
    }
  }

  throw new Error("Linear export does not contain issues.");
}

function parseLinearIssue(raw: unknown, index: number): LinearMigrationIssue {
  if (!isObject(raw)) {
    throw new Error(`Linear issue at index ${index} must be an object.`);
  }

  const externalTaskId = readString(raw.id) ?? readString(raw.identifier);
  const identifier = readString(raw.identifier) ?? externalTaskId;
  const title = readString(raw.title);
  const state = parseWorkflowState(raw.state, identifier ?? `index ${index}`);

  if (!externalTaskId) {
    throw new Error(`Linear issue at index ${index} is missing id or identifier.`);
  }

  if (!identifier) {
    throw new Error(`Linear issue ${externalTaskId} is missing identifier.`);
  }

  if (!title) {
    throw new Error(`Linear issue ${identifier} is missing title.`);
  }

  const issue: LinearMigrationIssue = {
    externalTaskId,
    identifier,
    title,
    priority: parsePriority(raw.priority),
    state,
    labels: parseLinearLabels(raw.labels),
  };

  const description = readString(raw.description);
  if (description) {
    issue.description = description;
  }

  const url = readString(raw.url);
  if (url) {
    issue.url = url;
  }

  const syncCursor = readString(raw.updatedAt) ?? readString(raw.updated_at);
  if (syncCursor) {
    issue.syncCursor = syncCursor;
  }

  return issue;
}

function parseWorkflowState(value: unknown, identifier: string): WorkflowState {
  const stateName = isObject(value) ? readString(value.name) : readString(value);

  if (!stateName || !isWorkflowState(stateName)) {
    throw new Error(`Linear issue ${identifier} has unsupported workflow state: ${stateName}`);
  }

  return stateName;
}

function parseLinearLabels(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((label) => parseLabelName(label)).filter((label) => label.length > 0);
  }

  if (isObject(value) && Array.isArray(value.nodes)) {
    return value.nodes.map((label) => parseLabelName(label)).filter((label) => label.length > 0);
  }

  return [];
}

function parseLabelName(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (isObject(value)) {
    return readString(value.name) ?? "";
  }

  return "";
}

function parsePriority(value: unknown): string | null {
  if (typeof value === "number") {
    return priorityByNumber.get(value) ?? null;
  }

  if (typeof value === "string") {
    const priority = value.trim().toLowerCase();
    return priority.length > 0 ? priority : null;
  }

  if (isObject(value)) {
    return readString(value.name)?.toLowerCase() ?? null;
  }

  return null;
}

function resolvePlaneLabelIds(
  labels: readonly string[],
  labelsByName: ReadonlyMap<string, PlaneLabel>,
): { labelIds: string[]; missingLabels: string[] } {
  const labelIds: string[] = [];
  const missingLabels: string[] = [];

  for (const label of labels) {
    const planeLabel = labelsByName.get(normalizeName(label));
    if (planeLabel) {
      labelIds.push(planeLabel.id);
    } else {
      missingLabels.push(label);
    }
  }

  return { labelIds, missingLabels };
}

function renderMigratedIssueDescription(issue: LinearMigrationIssue): string {
  const parts = [
    "<p><strong>Migrated from Linear/Symphony.</strong></p>",
    `<p><strong>Original:</strong> ${escapeHtml(issue.identifier)}</p>`,
    `<p><strong>Original state:</strong> ${escapeHtml(issue.state)}</p>`,
  ];

  if (issue.url) {
    parts.push(
      `<p><strong>Linear URL:</strong> <a href="${escapeHtml(issue.url)}">${escapeHtml(
        issue.url,
      )}</a></p>`,
    );
  }

  if (issue.description) {
    parts.push(`<hr><p>${escapeHtml(issue.description).replaceAll("\n", "<br>")}</p>`);
  }

  return parts.join("");
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
