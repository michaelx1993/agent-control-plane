import { getPromptReleaseDetail, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    releaseId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { releaseId } = await context.params;
  const release = await withDatabasePool((pool) => getPromptReleaseDetail(pool, releaseId));

  if (!release) {
    return NextResponse.json({ error: "Prompt release not found" }, { status: 404 });
  }

  return NextResponse.json({
    release,
  });
}
