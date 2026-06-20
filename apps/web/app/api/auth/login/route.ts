import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  createOperatorSessionToken,
  OPERATOR_SESSION_COOKIE,
  operatorSessionTtlSeconds,
} from "../../../../src/auth";
import {
  getDbBackedOperatorContext,
  isOperatorLoginConfigured,
  verifyOperatorPassword,
} from "../../../../src/operator";

export async function POST(request: NextRequest) {
  if (!isOperatorLoginConfigured()) {
    return NextResponse.json({ error: "Operator login is not configured." }, { status: 503 });
  }

  const password = await readPassword(request);
  const secret = process.env.ACP_OPERATOR_SESSION_SECRET?.trim();
  if (!secret || !verifyOperatorPassword(password)) {
    return NextResponse.json({ error: "Invalid operator credentials." }, { status: 401 });
  }

  const operator = await getDbBackedOperatorContext();
  const ttlSeconds = operatorSessionTtlSeconds();
  const token = await createOperatorSessionToken(operator, secret, ttlSeconds);
  const cookieStore = await cookies();
  cookieStore.set(OPERATOR_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.ACP_ENV === "production",
    path: "/",
    maxAge: ttlSeconds,
  });

  return NextResponse.json({ ok: true, operator });
}

async function readPassword(request: NextRequest): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => ({}))) as { password?: unknown };
    return typeof payload.password === "string" ? payload.password : "";
  }

  const formData = await request.formData().catch(() => undefined);
  return String(formData?.get("password") ?? "");
}
