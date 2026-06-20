import { getRunDetail, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    runId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const run = await withDatabasePool((pool) => getRunDetail(pool, runId));

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({
    run,
  });
}
