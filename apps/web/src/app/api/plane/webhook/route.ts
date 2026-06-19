import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { syncPlaneWebhookPayload } from "../../../../lib/control-plane-service";

export async function POST(request: Request) {
  if (!isAuthorizedWebhook(request)) {
    return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return NextResponse.json(await syncPlaneWebhookPayload(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

function isAuthorizedWebhook(request: Request): boolean {
  const secret = process.env.PLANE_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  const candidate =
    request.headers.get("x-plane-webhook-secret") ??
    request.headers.get("x-control-plane-webhook-secret") ??
    bearerToken(request.headers.get("authorization"));

  return candidate ? constantTimeEqual(candidate, secret) : false;
}

function bearerToken(value: string | null): string | undefined {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }
  return value.slice("Bearer ".length).trim();
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
