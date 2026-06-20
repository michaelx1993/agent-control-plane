import { isWorkflowState, type WorkflowState } from "@agent-control-plane/core";
import type { PlaneLabel, PlaneState, PlaneWorkItem } from "./client.js";

export interface PlaneTaskSyncRecord {
  externalTaskId: string;
  identifier: string;
  title: string;
  state: WorkflowState;
  labels: string[];
  priority: number | null;
  url?: string;
  syncCursor?: string;
}

export interface MapPlaneWorkItemInput {
  workItem: PlaneWorkItem;
  labelsById: ReadonlyMap<string, PlaneLabel>;
  statesById: ReadonlyMap<string, PlaneState>;
  projectIdentifier: string;
  baseUrl?: string;
  workspaceSlug?: string;
  projectId?: string;
}

const priorityByName: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 5,
};

export function mapPlaneWorkItemToTask(input: MapPlaneWorkItemInput): PlaneTaskSyncRecord {
  const stateName = resolveStateName(input.workItem, input.statesById);
  const labels = resolveLabelNames(input.workItem.labels ?? [], input.labelsById);

  const record: PlaneTaskSyncRecord = {
    externalTaskId: input.workItem.id,
    identifier: buildIdentifier(input.projectIdentifier, input.workItem),
    title: input.workItem.name,
    state: stateName,
    labels,
    priority: mapPriority(input.workItem.priority),
  };

  const url = buildWorkItemUrl(input);
  if (url) {
    record.url = url;
  }

  if (input.workItem.updated_at) {
    record.syncCursor = input.workItem.updated_at;
  }

  return record;
}

function resolveStateName(
  workItem: PlaneWorkItem,
  statesById: ReadonlyMap<string, PlaneState>,
): WorkflowState {
  const stateName = workItem.state ? (statesById.get(workItem.state)?.name ?? workItem.state) : "";

  if (!isWorkflowState(stateName)) {
    throw new Error(`Plane work item ${workItem.id} has unsupported workflow state: ${stateName}`);
  }

  return stateName;
}

function resolveLabelNames(
  labelIds: readonly string[],
  labelsById: ReadonlyMap<string, PlaneLabel>,
): string[] {
  return labelIds.map((labelId) => labelsById.get(labelId)?.name ?? `label:${labelId}`);
}

function buildIdentifier(projectIdentifier: string, workItem: PlaneWorkItem): string {
  if (typeof workItem.sequence_id === "number") {
    return `${projectIdentifier}-${workItem.sequence_id}`;
  }

  return workItem.id;
}

function mapPriority(priority: string | null | undefined): number | null {
  if (!priority) {
    return null;
  }

  return priorityByName[priority.toLowerCase()] ?? null;
}

function buildWorkItemUrl(input: MapPlaneWorkItemInput): string | undefined {
  if (!input.baseUrl || !input.workspaceSlug || !input.projectId) {
    return undefined;
  }

  return `${input.baseUrl}/workspace/${input.workspaceSlug}/projects/${input.projectId}/issues/${input.workItem.id}`;
}
