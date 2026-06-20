import {
  createAgentDefinitionSettings,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface AgentDefinitionBody {
  roleId?: unknown;
  name?: unknown;
  runtime?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  toolProfile?: unknown;
  maxTurns?: unknown;
  timeoutSeconds?: unknown;
  status?: unknown;
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as AgentDefinitionBody;
  const roleId = stringValue(payload.roleId);
  const name = stringValue(payload.name);
  const runtime = stringValue(payload.runtime);
  const model = stringValue(payload.model);
  const reasoningEffort = stringValue(payload.reasoningEffort);
  const toolProfile = stringValue(payload.toolProfile);
  const maxTurns = numberValue(payload.maxTurns);
  const timeoutSeconds = numberValue(payload.timeoutSeconds);

  if (
    !roleId ||
    !name ||
    !runtime ||
    !model ||
    !reasoningEffort ||
    !toolProfile ||
    maxTurns === undefined ||
    timeoutSeconds === undefined
  ) {
    return NextResponse.json(
      {
        error:
          "roleId, name, runtime, model, reasoningEffort, toolProfile, maxTurns and timeoutSeconds are required",
      },
      { status: 400 },
    );
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      createAgentDefinitionSettings(client, {
        roleId,
        name,
        runtime,
        model,
        reasoningEffort,
        toolProfile,
        maxTurns,
        timeoutSeconds,
        ...(stringValue(payload.status) ? { status: stringValue(payload.status) } : {}),
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

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
