import { listOperatorRuns, withDatabasePool } from "@agent-control-plane/db";
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

function normalizeRole(value: string | null) {
  return value && roles.includes(value as (typeof roles)[number])
    ? (value as (typeof roles)[number])
    : undefined;
}

function normalizeText(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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
