import { updateRoleSettings, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    roleId: string;
  }>;
}

interface RoleBody {
  name?: unknown;
  activeStates?: unknown;
  nextStates?: unknown;
  status?: unknown;
  description?: unknown;
}

export async function POST(request: Request, context: RouteContext) {
  const { roleId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as RoleBody;
  const name = stringValue(payload.name);
  const activeStates = statesValue(payload.activeStates);
  const nextStates = statesValue(payload.nextStates);
  const status = stringValue(payload.status) || "active";

  if (!name || activeStates.length === 0 || nextStates.length === 0) {
    return NextResponse.json(
      { error: "name, activeStates, and nextStates are required" },
      { status: 400 },
    );
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      updateRoleSettings(client, {
        roleId,
        name,
        activeStates,
        nextStates,
        status,
        ...(stringValue(payload.description)
          ? { description: stringValue(payload.description) }
          : {}),
      }),
    ),
  );

  if (!result.updated) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 400 });
  }

  return NextResponse.json(result);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function statesValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return stringValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
