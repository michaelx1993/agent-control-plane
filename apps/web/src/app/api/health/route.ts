import { NextResponse } from "next/server";

import { healthSignals, queueSummary } from "@/lib/mock-data";

export function GET() {
  return NextResponse.json({
    service: "agent-control-plane-web",
    status: healthSignals.some((signal) => signal.state === "degraded") ? "degraded" : "ok",
    checkedAt: new Date("2026-06-18T16:20:00.000Z").toISOString(),
    queue: queueSummary,
    signals: healthSignals,
  });
}
