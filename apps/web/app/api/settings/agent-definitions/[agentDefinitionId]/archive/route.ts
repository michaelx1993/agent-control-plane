import {
  archiveAgentDefinitionSettings,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    agentDefinitionId: string;
  }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { agentDefinitionId } = await context.params;
  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) => archiveAgentDefinitionSettings(client, agentDefinitionId)),
  );

  if (!result.updated) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 409 });
  }

  return NextResponse.json(result);
}
