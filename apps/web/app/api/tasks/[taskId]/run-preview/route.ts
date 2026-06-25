import { previewPlaneRuntimeForTask, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const url = new URL(request.url);
  const workerId = url.searchParams.get("workerId")?.trim() || undefined;
  const preview = await withDatabasePool((pool) =>
    previewPlaneRuntimeForTask(pool, {
      taskId,
      ...(workerId ? { workerId } : {}),
    }),
  );

  if (!preview) {
    return NextResponse.json(
      {
        error: "Run preview is unavailable for this task.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    preview,
  });
}
