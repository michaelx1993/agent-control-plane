import { NextResponse } from "next/server";

import { runs } from "@/lib/mock-data";

export function GET() {
  return NextResponse.json({
    count: runs.length,
    runs,
  });
}
