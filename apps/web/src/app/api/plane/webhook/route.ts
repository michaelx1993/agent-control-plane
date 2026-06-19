import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { syncPlaneWebhookPayload } from "../../../../lib/control-plane-service";

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!isAuthorizedWebhook(request, rawBody)) {
    return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
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

function isAuthorizedWebhook(request: Request, rawBody: string): boolean {
  const secret = process.env.PLANE_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  const signature = request.headers.get("x-plane-signature");
  if (signature) {
    return verifyPlaneSignature(rawBody, signature, secret);
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

function verifyPlaneSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const candidate = signature.trim().startsWith("sha256=")
    ? signature.trim().slice("sha256=".length)
    : signature.trim();

  return constantTimeEqual(candidate, expected);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
