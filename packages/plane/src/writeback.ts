import type { WorkflowState } from "@agent-control-plane/core";
import type { PlaneConfig } from "./config.js";
import { PlaneClient } from "./client.js";

export interface PlaneRunCompletionWritebackInput {
  externalTaskId: string;
  nextState: WorkflowState;
  summary: string;
}

export interface PlaneTaskStateWritebackInput {
  externalTaskId: string;
  nextState: WorkflowState;
  status: string;
  summary: string;
}

export interface PlaneWritebackClient {
  listProjectStates(
    workspaceSlug: string,
    projectId: string,
  ): Promise<{ id: string; name: string }[]>;
  updateWorkItemState(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
    stateId: string,
  ): Promise<void>;
  createWorkItemComment(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
    commentHtml: string,
  ): Promise<void>;
}

export async function writePlaneRunCompletion(
  config: PlaneConfig,
  input: PlaneRunCompletionWritebackInput,
  client: PlaneWritebackClient = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  }),
): Promise<void> {
  await writePlaneTaskStateChange(
    config,
    {
      externalTaskId: input.externalTaskId,
      nextState: input.nextState,
      status: "Completed",
      summary: input.summary,
    },
    client,
  );
}

export async function writePlaneTaskStateChange(
  config: PlaneConfig,
  input: PlaneTaskStateWritebackInput,
  client: PlaneWritebackClient = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  }),
): Promise<void> {
  const states = await client.listProjectStates(config.workspaceSlug, config.projectId);
  const state = states.find((candidate) => candidate.name === input.nextState);

  if (!state) {
    throw new Error(`Plane state not found for workflow state: ${input.nextState}`);
  }

  await client.updateWorkItemState(
    config.workspaceSlug,
    config.projectId,
    input.externalTaskId,
    state.id,
  );
  await client.createWorkItemComment(
    config.workspaceSlug,
    config.projectId,
    input.externalTaskId,
    renderStateChangeComment(input),
  );
}

function renderStateChangeComment(input: PlaneTaskStateWritebackInput): string {
  return `<p><strong>Agent Status:</strong> ${escapeHtml(
    input.status,
  )}</p><p><strong>Next State:</strong> ${escapeHtml(input.nextState)}</p><p>${escapeHtml(
    input.summary,
  )}</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
