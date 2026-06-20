import { getPromptComponentMetrics, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    componentId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { componentId } = await context.params;
  const metrics = await withDatabasePool((pool) => getPromptComponentMetrics(pool, componentId));

  if (!metrics) {
    return NextResponse.json({ error: "Prompt component not found" }, { status: 404 });
  }

  return NextResponse.json({ metrics });
}
