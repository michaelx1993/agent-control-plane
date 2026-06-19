import { NextResponse } from "next/server";

import { getSystemHealth } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getSystemHealth());
}
