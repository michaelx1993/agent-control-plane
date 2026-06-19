import { NextResponse } from "next/server";

import { getPromptReleases } from "../../../lib/control-plane-service";

export function GET() {
  return NextResponse.json(getPromptReleases());
}
