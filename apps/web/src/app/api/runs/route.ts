import { NextResponse } from "next/server";

import { getRuns } from "../../../lib/control-plane-service";

export function GET() {
  return NextResponse.json(getRuns());
}
