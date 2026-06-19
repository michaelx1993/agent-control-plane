import { NextResponse } from "next/server";

import { getMonitoring } from "../../../lib/control-plane-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const windowHours = Number(url.searchParams.get("windowHours") ?? "24");

  return NextResponse.json(
    await getMonitoring(Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24),
  );
}
