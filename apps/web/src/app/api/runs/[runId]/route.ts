import { NextResponse } from "next/server";

import { getRunDetail } from "../../../../lib/control-plane-service";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const run = await getRunDetail(runId);

  if (!run) {
    return NextResponse.json({ error: `Run ${runId} not found` }, { status: 404 });
  }

  return NextResponse.json({ run });
}
