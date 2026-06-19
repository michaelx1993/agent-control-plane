import { NextResponse } from "next/server";

import {
  releaseTaskRetry,
  type ReleaseTaskRetryInput,
} from "../../../../../lib/control-plane-service";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseReleaseTaskRetryInput(body);
  if (parsed instanceof Error) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  try {
    return NextResponse.json(await releaseTaskRetry(decodeURIComponent(taskId), parsed), {
      status: 200,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

function parseReleaseTaskRetryInput(body: unknown): ReleaseTaskRetryInput | Error {
  if (!isRecord(body)) {
    return new Error("Body must be an object");
  }

  const reason = optionalStringField(body, "reason");
  return { reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
