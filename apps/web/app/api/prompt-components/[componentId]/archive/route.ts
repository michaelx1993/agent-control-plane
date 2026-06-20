import { archivePromptComponent, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    componentId: string;
  }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { componentId } = await context.params;
  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) => archivePromptComponent(client, componentId)),
  );

  if (!result.updated) {
    return NextResponse.json(result, {
      status: result.reason === "component_not_found" ? 404 : 409,
    });
  }

  return NextResponse.json(result);
}
