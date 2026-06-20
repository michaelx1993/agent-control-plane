import { fetchTaskExternalRef, requestTaskRework, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";
import { maybeWritePlaneTaskState } from "../../../../../src/plane-writeback";

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

interface ReworkBody {
  body?: unknown;
  source?: unknown;
  severity?: unknown;
  runId?: unknown;
  externalUrl?: unknown;
}

const allowedSources = ["human", "code_review", "pr_review", "agent", "plane_comment"] as const;
const allowedSeverities = ["info", "minor", "major", "blocker"] as const;

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as ReworkBody;
  const body = typeof payload.body === "string" ? payload.body.trim() : "";

  if (!body) {
    return NextResponse.json({ error: "Feedback body is required" }, { status: 400 });
  }

  const source = normalizeSource(payload.source);
  const severity = normalizeSeverity(payload.severity);
  const runId = typeof payload.runId === "string" && payload.runId ? payload.runId : undefined;
  const externalUrl =
    typeof payload.externalUrl === "string" && payload.externalUrl
      ? payload.externalUrl
      : undefined;

  const result = await withDatabasePool(async (pool) => {
    const rework = await requestTaskRework(pool, {
      taskId,
      body,
      source,
      severity,
      ...(runId ? { runId } : {}),
      ...(externalUrl ? { externalUrl } : {}),
    });
    const externalRef = rework.updated ? await fetchTaskExternalRef(pool, taskId) : undefined;

    return {
      rework,
      externalRef,
    };
  });

  if (!result.rework.updated) {
    const status = result.rework.reason === "task_not_found" ? 404 : 409;
    return NextResponse.json(result.rework, { status });
  }

  const planeWriteback =
    result.externalRef && result.rework.nextState
      ? await maybeWritePlaneTaskState({
          externalTaskId: result.externalRef.externalTaskId,
          nextState: result.rework.nextState,
          status: "Rework Requested",
          summary: body,
        })
      : { attempted: false, ok: true };

  return NextResponse.json({
    ...result.rework,
    planeWriteback,
  });
}

function normalizeSource(value: unknown): (typeof allowedSources)[number] {
  return typeof value === "string" &&
    allowedSources.includes(value as (typeof allowedSources)[number])
    ? (value as (typeof allowedSources)[number])
    : "human";
}

function normalizeSeverity(value: unknown): (typeof allowedSeverities)[number] {
  return typeof value === "string" &&
    allowedSeverities.includes(value as (typeof allowedSeverities)[number])
    ? (value as (typeof allowedSeverities)[number])
    : "major";
}
