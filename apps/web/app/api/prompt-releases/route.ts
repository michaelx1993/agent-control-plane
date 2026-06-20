import { listPromptReleases, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const releases = await withDatabasePool((pool) => listPromptReleases(pool, limit));

  return NextResponse.json({
    releases,
  });
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
