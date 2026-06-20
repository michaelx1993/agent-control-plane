import {
  listOperatorTasks,
  withDatabasePool,
  type TaskLeaseFilter,
  type TaskQueueMode,
  type TaskRetryFilter,
} from "@agent-control-plane/db";
import { isWorkflowState } from "@agent-control-plane/core";
import { NextResponse } from "next/server";

const allowedModes = ["all", "agent", "human", "terminal", "blocked"] as const;
const allowedLeaseFilters = ["active", "none", "expired"] as const;
const allowedRetryFilters = ["retryable", "waiting", "ready", "blocked"] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = normalizeState(url.searchParams.get("state"));
  const mode = normalizeMode(url.searchParams.get("mode"));
  const projectSlug = normalizeText(url.searchParams.get("project"));
  const repositorySlug = normalizeText(url.searchParams.get("repository"));
  const lease = normalizeLeaseFilter(url.searchParams.get("lease"));
  const retry = normalizeRetryFilter(url.searchParams.get("retry"));
  const limit = parseLimit(url.searchParams.get("limit"));

  const tasks = await withDatabasePool((pool) =>
    listOperatorTasks(pool, {
      ...(state ? { state } : {}),
      ...(mode ? { mode } : {}),
      ...(projectSlug ? { projectSlug } : {}),
      ...(repositorySlug ? { repositorySlug } : {}),
      ...(lease ? { lease } : {}),
      ...(retry ? { retry } : {}),
      ...(limit ? { limit } : {}),
    }),
  );

  return NextResponse.json({
    tasks,
  });
}

function normalizeState(value: string | null) {
  return value && isWorkflowState(value) ? value : undefined;
}

function normalizeMode(value: string | null): TaskQueueMode | undefined {
  return value && allowedModes.includes(value as TaskQueueMode)
    ? (value as TaskQueueMode)
    : undefined;
}

function normalizeLeaseFilter(value: string | null): TaskLeaseFilter | undefined {
  return value && allowedLeaseFilters.includes(value as TaskLeaseFilter)
    ? (value as TaskLeaseFilter)
    : undefined;
}

function normalizeRetryFilter(value: string | null): TaskRetryFilter | undefined {
  return value && allowedRetryFilters.includes(value as TaskRetryFilter)
    ? (value as TaskRetryFilter)
    : undefined;
}

function normalizeText(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
