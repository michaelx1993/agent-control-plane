import type { PromptScope } from "@agent-control-plane/core";
import {
  createPromptComponentVersion,
  listPromptComponents,
  withDatabasePool,
  withTransaction,
  type PromptComponentStatus,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

const scopes = ["global", "team", "project", "repo", "role", "agent"] as const;
const statuses = ["draft", "active", "archived"] as const;

interface CreatePromptComponentBody {
  scope?: unknown;
  scopeId?: unknown;
  name?: unknown;
  content?: unknown;
  status?: unknown;
  changelog?: unknown;
  author?: unknown;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = normalizeScope(url.searchParams.get("scope"));
  const status = normalizeStatus(url.searchParams.get("status"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const components = await withDatabasePool((pool) =>
    listPromptComponents(pool, {
      ...(scope ? { scope } : {}),
      ...(status ? { status } : {}),
      ...(limit ? { limit } : {}),
    }),
  );

  return NextResponse.json({ components });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as CreatePromptComponentBody;
  const scope = normalizeScope(typeof payload.scope === "string" ? payload.scope : null);
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const content = typeof payload.content === "string" ? payload.content : "";
  const status = normalizeStatus(typeof payload.status === "string" ? payload.status : null);

  if (!scope || !name || !content.trim()) {
    return NextResponse.json({ error: "scope, name, and content are required" }, { status: 400 });
  }

  const scopeId =
    typeof payload.scopeId === "string" && payload.scopeId ? payload.scopeId : undefined;
  const changelog =
    typeof payload.changelog === "string" && payload.changelog ? payload.changelog : undefined;
  const author = typeof payload.author === "string" && payload.author ? payload.author : undefined;

  const component = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      createPromptComponentVersion(client, {
        scope,
        ...(scopeId ? { scopeId } : {}),
        name,
        content,
        ...(status ? { status } : {}),
        ...(changelog ? { changelog } : {}),
        ...(author ? { author } : {}),
      }),
    ),
  );

  return NextResponse.json({ component }, { status: 201 });
}

function normalizeScope(value: string | null): PromptScope | undefined {
  return value && scopes.includes(value as PromptScope) ? (value as PromptScope) : undefined;
}

function normalizeStatus(value: string | null): PromptComponentStatus | undefined {
  return value && statuses.includes(value as PromptComponentStatus)
    ? (value as PromptComponentStatus)
    : undefined;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
