import { NextResponse } from "next/server";

import { getTaskQueue } from "../../../lib/control-plane-service";

export function GET() {
  return NextResponse.json(getTaskQueue());
}
