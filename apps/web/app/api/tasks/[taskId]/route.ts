import { getTaskDetail, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const task = await withDatabasePool((pool) => getTaskDetail(pool, taskId));

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({
    task,
  });
}
