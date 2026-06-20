import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OPERATOR_SESSION_COOKIE } from "../../../../src/auth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(OPERATOR_SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
