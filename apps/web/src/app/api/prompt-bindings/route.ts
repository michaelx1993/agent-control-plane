import { NextResponse } from "next/server";

import { requireOperatorAuth } from "../../../lib/api-auth";
import {
  createPromptBinding,
  getPromptBindings,
  type CreatePromptBindingInput,
} from "../../../lib/control-plane-service";

const promptScopeTypes = new Set(["team", "project", "repo", "role", "agent"]);
const promptEnvironments = new Set(["dev", "staging", "prod"]);
const promptBindingStatuses = new Set(["active", "disabled"]);

export async function GET() {
  return NextResponse.json(await getPromptBindings());
}

export async function POST(request: Request) {
  const unauthorized = requireOperatorAuth(request);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseCreatePromptBindingInput(body);
  if (parsed instanceof Error) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  try {
    const binding = await createPromptBinding(parsed);
    return NextResponse.json(binding, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

function parseCreatePromptBindingInput(body: unknown): CreatePromptBindingInput | Error {
  if (!isRecord(body)) {
    return new Error("Body must be an object");
  }

  const scopeType = stringField(body, "scopeType");
  const scopeId = stringField(body, "scopeId");
  const promptComponentId = stringField(body, "promptComponentId");
  const environment = optionalStringField(body, "environment");
  const status = optionalStringField(body, "status");

  if (!scopeType || !promptScopeTypes.has(scopeType)) {
    return new Error("scopeType must be one of team/project/repo/role/agent");
  }

  if (!scopeId) {
    return new Error("scopeId is required");
  }

  if (!promptComponentId) {
    return new Error("promptComponentId is required");
  }

  if (environment && !promptEnvironments.has(environment)) {
    return new Error("environment must be dev, staging, or prod");
  }

  if (status && !promptBindingStatuses.has(status)) {
    return new Error("status must be active or disabled");
  }

  return {
    scopeType,
    scopeId,
    promptComponentId,
    orderIndex: optionalNumberField(body, "orderIndex") ?? 0,
    environment,
    status,
  } as CreatePromptBindingInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value.trim() : undefined;
}

function optionalNumberField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
