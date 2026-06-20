import {
  updateRepositorySettings,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    repositoryId: string;
  }>;
}

interface RepositoryBody {
  slug?: unknown;
  gitUrl?: unknown;
  defaultBranch?: unknown;
  localPath?: unknown;
  status?: unknown;
  description?: unknown;
}

export async function POST(request: Request, context: RouteContext) {
  const { repositoryId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as RepositoryBody;
  const slug = stringValue(payload.slug);
  const gitUrl = stringValue(payload.gitUrl);
  const defaultBranch = stringValue(payload.defaultBranch);
  const status = stringValue(payload.status) || "active";

  if (!slug || !gitUrl || !defaultBranch) {
    return NextResponse.json(
      { error: "slug, gitUrl, and defaultBranch are required" },
      { status: 400 },
    );
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      updateRepositorySettings(client, {
        repositoryId,
        slug,
        gitUrl,
        defaultBranch,
        status,
        ...(stringValue(payload.localPath) ? { localPath: stringValue(payload.localPath) } : {}),
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
