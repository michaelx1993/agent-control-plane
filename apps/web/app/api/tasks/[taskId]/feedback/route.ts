import {
  fetchTaskExternalRef,
  recordTaskFeedback,
  requestTaskRework,
  withDatabasePool,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";
import { maybeWritePlaneTaskState } from "../../../../../src/plane-writeback";

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

interface FeedbackBody {
  body?: unknown;
  source?: unknown;
  severity?: unknown;
  runId?: unknown;
  externalUrl?: unknown;
  requestRework?: unknown;
}

const allowedSources = ["human", "code_review", "pr_review", "agent", "plane_comment"] as const;
const allowedSeverities = ["info", "minor", "major", "blocker"] as const;

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as FeedbackBody;
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
  const requestRework = payload.requestRework === true;

  if (requestRework) {
    return requestReworkWithFeedback({
      taskId,
      body,
      source,
      severity,
      ...(runId ? { runId } : {}),
      ...(externalUrl ? { externalUrl } : {}),
    });
  }

  const feedback = await withDatabasePool((pool) =>
    recordTaskFeedback(pool, {
      taskId,
      body,
      source,
      severity,
      ...(runId ? { runId } : {}),
      ...(externalUrl ? { externalUrl } : {}),
    }),
  );

  if (!feedback.inserted) {
    const status = feedback.reason === "task_not_found" ? 404 : 200;
    return NextResponse.json(feedback, { status });
  }

  return NextResponse.json(feedback);
}

async function requestReworkWithFeedback(input: {
  taskId: string;
  body: string;
  source: (typeof allowedSources)[number];
  severity: (typeof allowedSeverities)[number];
  runId?: string;
  externalUrl?: string;
}) {
  const result = await withDatabasePool(async (pool) => {
    const rework = await requestTaskRework(pool, {
      taskId: input.taskId,
      body: input.body,
      source: input.source,
      severity: input.severity,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.externalUrl ? { externalUrl: input.externalUrl } : {}),
    });
    const externalRef = rework.updated ? await fetchTaskExternalRef(pool, input.taskId) : undefined;

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
          summary: input.body,
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
    : "pr_review";
}

function normalizeSeverity(value: unknown): (typeof allowedSeverities)[number] {
  return typeof value === "string" &&
    allowedSeverities.includes(value as (typeof allowedSeverities)[number])
    ? (value as (typeof allowedSeverities)[number])
    : "major";
}
