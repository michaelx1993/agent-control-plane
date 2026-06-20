import { createRoleSettings, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RoleBody {
  key?: unknown;
  name?: unknown;
  activeStates?: unknown;
  nextStates?: unknown;
  status?: unknown;
  description?: unknown;
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RoleBody;
  const key = stringValue(payload.key);
  const name = stringValue(payload.name);
  const activeStates = stringList(payload.activeStates);
  const nextStates = stringList(payload.nextStates);

  if (!key || !name || activeStates.length === 0 || nextStates.length === 0) {
    return NextResponse.json(
      { error: "key, name, activeStates and nextStates are required" },
      { status: 400 },
    );
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      createRoleSettings(client, {
        key,
        name,
        activeStates,
        nextStates,
        ...(stringValue(payload.status) ? { status: stringValue(payload.status) } : {}),
        ...(stringValue(payload.description)
          ? { description: stringValue(payload.description) }
          : {}),
      }),
    ),
  );

  if (!result.updated) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result, { status: 201 });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim());
  }

  return stringValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
