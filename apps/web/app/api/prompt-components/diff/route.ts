import { diffPromptComponents, withDatabasePool } from "@agent-control-plane/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from")?.trim();
  const to = url.searchParams.get("to")?.trim();

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  const diff = await withDatabasePool((pool) => diffPromptComponents(pool, from, to));
  if (!diff) {
    return NextResponse.json({ error: "Prompt component not found" }, { status: 404 });
  }

  return NextResponse.json({ diff });
}
