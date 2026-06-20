import { isWorkflowState } from "@agent-control-plane/core";
import {
  fetchTaskExternalRef,
  transitionTaskState,
  withDatabasePool,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";
import { maybeWritePlaneTaskState } from "../../../../../src/plane-writeback";

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

interface TransitionBody {
  targetState?: unknown;
  actor?: unknown;
  reason?: unknown;
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as TransitionBody;
  const targetState = typeof payload.targetState === "string" ? payload.targetState : "";

  if (!isWorkflowState(targetState)) {
    return NextResponse.json({ error: "Valid targetState is required" }, { status: 400 });
  }

  const actor = typeof payload.actor === "string" && payload.actor ? payload.actor : undefined;
  const reason = typeof payload.reason === "string" && payload.reason ? payload.reason : undefined;
  const result = await withDatabasePool(async (pool) => {
    const transition = await transitionTaskState(pool, {
      taskId,
      targetState,
      ...(actor ? { actor } : {}),
      ...(reason ? { reason } : {}),
    });
    const externalRef = transition.updated ? await fetchTaskExternalRef(pool, taskId) : undefined;

    return {
      transition,
      externalRef,
    };
  });

  if (!result.transition.updated) {
    const status = result.transition.reason === "task_not_found" ? 404 : 409;
    return NextResponse.json(result.transition, { status });
  }

  const planeWriteback =
    result.externalRef && result.transition.nextState
      ? await maybeWritePlaneTaskState({
          externalTaskId: result.externalRef.externalTaskId,
          nextState: result.transition.nextState,
          status: "Human Gate Updated",
          summary: reason ?? `Operator moved ${result.externalRef.identifier} to ${targetState}.`,
        })
      : { attempted: false, ok: true };

  return NextResponse.json({
    ...result.transition,
    planeWriteback,
  });
}
