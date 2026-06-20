import { archiveRoleSettings, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    roleId: string;
  }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { roleId } = await context.params;
  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) => archiveRoleSettings(client, roleId)),
  );

  if (!result.updated) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 409 });
  }

  return NextResponse.json(result);
}
