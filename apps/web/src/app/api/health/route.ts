import { NextResponse } from "next/server";

import { getSystemHealth } from "../../../lib/control-plane-service";

export function GET() {
  return NextResponse.json(getSystemHealth());
}
