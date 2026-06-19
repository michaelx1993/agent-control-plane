import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function requireOperatorAuth(request: Request): NextResponse | undefined {
  const token = process.env.CONTROL_PLANE_API_TOKEN;
  if (!token) {
    return undefined;
  }

  const candidate =
    bearerToken(request.headers.get("authorization")) ??
    request.headers.get("x-control-plane-token") ??
    "";

  if (constantTimeEqual(candidate, token)) {
    return undefined;
  }

  return NextResponse.json({ error: "Unauthorized operator request" }, { status: 401 });
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
