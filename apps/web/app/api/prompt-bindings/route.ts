import {
  createPromptBinding,
  listPromptBindings,
  withDatabasePool,
  withTransaction,
  type CreatePromptBindingInput,
  type PromptBindingScope,
} from "@agent-control-plane/db";
import {
  canRequestPromptBinding,
  getOperatorContext,
  promptBindingPermissionMessage,
} from "../../../src/operator";
import { NextResponse } from "next/server";

const bindingScopes = ["team", "project", "repo", "role", "agent"] as const;

interface CreatePromptBindingBody {
  scope?: unknown;
  scopeId?: unknown;
  promptComponentId?: unknown;
  orderIndex?: unknown;
  environment?: unknown;
}

export async function GET() {
  const promptBindings = await withDatabasePool((pool) => listPromptBindings(pool));
  return NextResponse.json({ promptBindings });
}

export async function POST(request: Request) {
  const operator = getOperatorContext();
  if (!canRequestPromptBinding(operator)) {
    return NextResponse.json(
      { error: promptBindingPermissionMessage("request"), operator },
      { status: 403 },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as CreatePromptBindingBody;
  const input = parseCreatePromptBindingInput(payload);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      createPromptBinding(client, {
        ...input.value,
        actor: operator,
      }),
    ),
  );
  if (!result.updated) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result, { status: 201 });
}

function parseCreatePromptBindingInput(
  payload: CreatePromptBindingBody,
): { ok: true; value: CreatePromptBindingInput } | { ok: false; error: string } {
  const scope = typeof payload.scope === "string" ? parseScope(payload.scope) : undefined;
  if (!scope) {
    return { ok: false, error: "Valid scope is required" };
  }

  const scopeId = typeof payload.scopeId === "string" ? payload.scopeId.trim() : "";
  if (!scopeId) {
    return { ok: false, error: "scopeId is required" };
  }

  const promptComponentId =
    typeof payload.promptComponentId === "string" ? payload.promptComponentId.trim() : "";
  if (!promptComponentId) {
    return { ok: false, error: "promptComponentId is required" };
  }

  const orderIndex = parseOrderIndex(payload.orderIndex);
  if (orderIndex === undefined) {
    return { ok: false, error: "Valid orderIndex is required" };
  }

  const environment = typeof payload.environment === "string" ? payload.environment.trim() : "";

  return {
    ok: true,
    value: {
      scope,
      scopeId,
      promptComponentId,
      orderIndex,
      ...(environment ? { environment } : {}),
    },
  };
}

function parseScope(value: string): PromptBindingScope | undefined {
  return bindingScopes.includes(value as PromptBindingScope)
    ? (value as PromptBindingScope)
    : undefined;
}

function parseOrderIndex(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
