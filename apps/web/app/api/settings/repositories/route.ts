import {
  createRepositorySettings,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

interface RepositoryBody {
  projectId?: unknown;
  slug?: unknown;
  gitUrl?: unknown;
  defaultBranch?: unknown;
  localPath?: unknown;
  status?: unknown;
  description?: unknown;
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RepositoryBody;
  const projectId = stringValue(payload.projectId);
  const slug = stringValue(payload.slug);
  const gitUrl = stringValue(payload.gitUrl);
  const defaultBranch = stringValue(payload.defaultBranch);

  if (!projectId || !slug || !gitUrl || !defaultBranch) {
    return NextResponse.json(
      { error: "projectId, slug, gitUrl and defaultBranch are required" },
      { status: 400 },
    );
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      createRepositorySettings(client, {
        projectId,
        slug,
        gitUrl,
        defaultBranch,
        ...(stringValue(payload.localPath) ? { localPath: stringValue(payload.localPath) } : {}),
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
