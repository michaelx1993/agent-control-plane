import {
  listOperatorRuns,
  upsertPlaneRunIntentTask,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import { isWorkflowState } from "@agent-control-plane/core";
import { NextResponse } from "next/server";

const roles = [
  "intake",
  "development",
  "code_review",
  "merge",
  "release",
  "deploy",
  "human_gate",
  "terminal",
] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = normalizeStatus(url.searchParams.get("status"));
  const repositorySlug = normalizeText(url.searchParams.get("repository"));
  const role = normalizeRole(url.searchParams.get("role"));
  const taskIdentifier = normalizeText(url.searchParams.get("task"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const runs = await withDatabasePool((pool) =>
    listOperatorRuns(pool, {
      ...(status ? { status } : {}),
      ...(repositorySlug ? { repositorySlug } : {}),
      ...(role ? { role } : {}),
      ...(taskIdentifier ? { taskIdentifier } : {}),
      ...(limit ? { limit } : {}),
    }),
  );

  return NextResponse.json({
    runs,
  });
}

export async function POST(request: Request) {
  const payload = await parseJsonObject(request);
  const source = normalizeText(payload.source);
  if (source !== "plane") {
    return NextResponse.json({ error: "source must be plane." }, { status: 400 });
  }

  const planeProjectId = requiredText(payload.planeProjectId);
  const externalTaskId = requiredText(payload.externalTaskId);
  const identifier = requiredText(payload.identifier);
  const title = requiredText(payload.title);
  const state = normalizeWorkflowState(payload.state);
  const projectSlug = normalizeText(payload.projectSlug);
  const labels = normalizeStringArray(payload.labels);
  const priority = normalizePriority(payload.priority);
  const url = normalizeText(payload.url);
  const repositoryKey = normalizeText(payload.repositoryKey);
  const repositoryUrl = normalizeText(payload.repositoryUrl);
  const agentKey = normalizeText(payload.agentKey);
  const workerKey = normalizeText(payload.workerKey);
  const promptVersionIds = normalizeStringArray(payload.promptVersionIds);
  const availableSecretKeys = normalizeStringArray(payload.availableSecretKeys);

  if (!planeProjectId || !externalTaskId || !identifier || !title || !state) {
    return NextResponse.json(
      {
        error:
          "planeProjectId, externalTaskId, identifier, title, and supported state are required.",
      },
      { status: 400 },
    );
  }

  try {
    const task = await withDatabasePool((pool) =>
      withTransaction(pool, (transaction) =>
        upsertPlaneRunIntentTask(transaction, {
          planeProjectId,
          externalTaskId,
          identifier,
          title,
          state,
          ...(projectSlug ? { projectSlug } : {}),
          ...(labels.length ? { labels } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(url ? { url } : {}),
          ...(repositoryKey ? { repositoryKey } : {}),
          ...(repositoryUrl ? { repositoryUrl } : {}),
          ...(agentKey ? { agentKey } : {}),
          ...(workerKey ? { workerKey } : {}),
          ...(promptVersionIds.length ? { promptVersionIds } : {}),
          ...(availableSecretKeys.length ? { availableSecretKeys } : {}),
        }),
      ),
    );

    return NextResponse.json({
      ok: true,
      queued: true,
      task,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue Plane run intent.";
    const status = message.startsWith("Project not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function normalizeRole(value: string | null) {
  return value && roles.includes(value as (typeof roles)[number])
    ? (value as (typeof roles)[number])
    : undefined;
}

function normalizeText(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : undefined;
  return normalized ? normalized : undefined;
}

function requiredText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeWorkflowState(value: unknown) {
  const normalized = requiredText(value);
  return normalized && isWorkflowState(normalized) ? normalized : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim());
}

function normalizePriority(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.trunc(value);
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const payload = await request.json();
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeStatus(value: string | null) {
  if (!value) {
    return undefined;
  }

  const allowed = ["queued", "claimed", "running", "succeeded", "failed", "stalled"] as const;
  return allowed.find((status) => status === value);
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
