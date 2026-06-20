import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "../../../src/dashboard";

export async function GET() {
  const snapshot = await getDashboardSnapshot();

  return NextResponse.json({
    service: "agent-control-plane-web",
    ...snapshot,
  });
}
