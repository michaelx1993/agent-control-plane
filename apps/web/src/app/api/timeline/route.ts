import { NextResponse } from "next/server";

import { getOperatorTimeline } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getOperatorTimeline());
}
