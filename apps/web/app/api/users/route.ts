import {
  insertUserAuditEvent,
  listUsers,
  upsertOperatorUser,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import { NextResponse, type NextRequest } from "next/server";
import {
  canManageProjectSettings,
  getOperatorContext,
  projectSettingsPermissionMessage,
} from "../../../src/operator";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const users = await withDatabasePool((pool) =>
    listUsers(pool, { limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50 }),
  );

  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const operator = getOperatorContext();
  if (!canManageProjectSettings(operator)) {
    return NextResponse.json({ error: projectSettingsPermissionMessage() }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    userId?: unknown;
    externalProvider?: unknown;
    externalUserId?: unknown;
    name?: unknown;
    email?: unknown;
  };
  const name = stringValue(payload.name);
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  const userId = stringValue(payload.userId);
  const externalProvider = stringValue(payload.externalProvider);
  const externalUserId = stringValue(payload.externalUserId);
  const email = stringValue(payload.email);

  const user = await withDatabasePool((pool) =>
    withTransaction(pool, async (client) => {
      const user = await upsertOperatorUser(client, {
        ...(userId ? { userId } : {}),
        ...(externalProvider ? { externalProvider } : {}),
        ...(externalUserId ? { externalUserId } : {}),
        name,
        ...(email ? { email } : {}),
      });
      await insertUserAuditEvent(client, {
        userId: user.id,
        action: "user.upsert",
        message: "Operator user upserted.",
        actor: operator,
      });
      return user;
    }),
  );

  return NextResponse.json({ user });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
