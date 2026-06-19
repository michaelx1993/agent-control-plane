import { NextResponse } from "next/server";

import { getPromptComponentDiff } from "../../../../lib/control-plane-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const left = url.searchParams.get("left");
  const right = url.searchParams.get("right");

  if (!left || !right) {
    return NextResponse.json(
      { error: "left and right query params are required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await getPromptComponentDiff(left, right));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("DATABASE_URL")
      ? 503
      : message.includes("not found")
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
