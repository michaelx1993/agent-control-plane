import {
  updateAgentDefinitionSettings,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    agentDefinitionId: string;
  }>;
}

interface AgentDefinitionBody {
  name?: unknown;
  runtime?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  toolProfile?: unknown;
  maxTurns?: unknown;
  timeoutSeconds?: unknown;
  status?: unknown;
}

export async function POST(request: Request, context: RouteContext) {
  const { agentDefinitionId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as AgentDefinitionBody;
  const name = stringValue(payload.name);
  const runtime = stringValue(payload.runtime);
  const model = stringValue(payload.model);
  const reasoningEffort = stringValue(payload.reasoningEffort);
  const toolProfile = stringValue(payload.toolProfile);
  const maxTurns = numberValue(payload.maxTurns);
  const timeoutSeconds = numberValue(payload.timeoutSeconds);
  const status = stringValue(payload.status) || "active";

  if (
    !name ||
    !runtime ||
    !model ||
    !reasoningEffort ||
    !toolProfile ||
    !maxTurns ||
    !timeoutSeconds
  ) {
    return NextResponse.json(
      {
        error:
          "name, runtime, model, reasoningEffort, toolProfile, maxTurns, and timeoutSeconds are required",
      },
      { status: 400 },
    );
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      updateAgentDefinitionSettings(client, {
        agentDefinitionId,
        name,
        runtime,
        model,
        reasoningEffort,
        toolProfile,
        maxTurns,
        timeoutSeconds,
        status,
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

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
