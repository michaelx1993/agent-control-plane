import { NextResponse } from "next/server";

import { getPromptReleases } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getPromptReleases());
}
