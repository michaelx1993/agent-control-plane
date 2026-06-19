import { NextResponse } from "next/server";

import {
  createPromptComponent,
  getPromptComponents,
  type CreatePromptComponentInput,
} from "../../../lib/control-plane-service";

const promptScopeTypes = new Set(["global", "team", "project", "repo", "role", "agent"]);

const promptStatuses = new Set(["draft", "active", "archived"]);

export async function GET() {
  return NextResponse.json(await getPromptComponents());
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseCreatePromptComponentInput(body);
  if (parsed instanceof Error) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  try {
    const component = await createPromptComponent(parsed);
    return NextResponse.json(component, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

function parseCreatePromptComponentInput(body: unknown): CreatePromptComponentInput | Error {
  if (!isRecord(body)) {
    return new Error("Body must be an object");
  }

  const scopeType = stringField(body, "scopeType");
  const name = stringField(body, "name");
  const content = stringField(body, "content");
  const status = optionalStringField(body, "status");
  const version = optionalNumberField(body, "version");

  if (!scopeType || !promptScopeTypes.has(scopeType)) {
    return new Error("scopeType must be one of global/team/project/repo/role/agent");
  }

  if (!name) {
    return new Error("name is required");
  }

  if (!content) {
    return new Error("content is required");
  }

  if (status && !promptStatuses.has(status)) {
    return new Error("status must be draft, active, or archived");
  }

  return {
    scopeType,
    scopeId: optionalStringField(body, "scopeId") ?? null,
    name,
    content,
    status,
    changelog: optionalStringField(body, "changelog") ?? null,
    author: optionalStringField(body, "author") ?? null,
    version,
  } as CreatePromptComponentInput;
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
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
