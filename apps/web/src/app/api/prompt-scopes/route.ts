import { NextResponse } from "next/server";

import { getPromptScopes } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getPromptScopes());
}
