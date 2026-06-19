import { NextResponse } from "next/server";

import { requireOperatorAuth } from "../../../../../lib/api-auth";
import { transitionTask, type TransitionTaskInput } from "../../../../../lib/control-plane-service";

const allowedStates = new Set<TransitionTaskInput["nextState"]>([
  "Todo",
  "Development",
  "Code Review",
  "Human Review",
  "In Merge",
  "Merged",
  "Release Version",
  "Released",
  "Deployment",
  "Deployed",
  "Blocked",
  "Done",
  "Canceled",
]);

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const unauthorized = requireOperatorAuth(request);
  if (unauthorized) return unauthorized;

  const { taskId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as Partial<TransitionTaskInput>;

  if (!payload.nextState || !allowedStates.has(payload.nextState)) {
    return NextResponse.json(
      { error: "nextState must be a valid workflow state" },
      { status: 400 },
    );
  }

  try {
    const result = await transitionTask(taskId, {
      nextState: payload.nextState,
      reason: payload.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("DATABASE_URL")
      ? 503
      : message.includes("not found")
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
