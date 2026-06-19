import { NextResponse } from "next/server";

import { getSystemReadiness } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getSystemReadiness());
}
