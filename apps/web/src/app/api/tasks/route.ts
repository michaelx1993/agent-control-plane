import { NextResponse } from "next/server";

import { getTaskQueue } from "../../../lib/control-plane-service";

export async function GET() {
  return NextResponse.json(await getTaskQueue());
}
