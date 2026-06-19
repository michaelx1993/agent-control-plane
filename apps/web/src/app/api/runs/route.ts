import { NextResponse } from "next/server";

import { getRuns } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getRuns());
}
