import { NextResponse } from "next/server";
import { getReadinessSnapshot } from "../../../src/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const snapshot = await getReadinessSnapshot();

  return NextResponse.json({
    service: "agent-control-plane-web",
    ...snapshot,
  });
}
