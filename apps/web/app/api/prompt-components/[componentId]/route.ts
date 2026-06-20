import { getPromptComponentDetail, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    componentId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { componentId } = await context.params;
  const component = await withDatabasePool((pool) => getPromptComponentDetail(pool, componentId));

  if (!component) {
    return NextResponse.json({ error: "Prompt component not found" }, { status: 404 });
  }

  return NextResponse.json({ component });
}
