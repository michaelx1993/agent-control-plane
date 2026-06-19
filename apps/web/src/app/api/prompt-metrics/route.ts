import { NextResponse } from "next/server";

import { getPromptMetrics } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getPromptMetrics());
}
