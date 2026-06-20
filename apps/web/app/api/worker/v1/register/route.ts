import { NextResponse, type NextRequest } from "next/server";
import { isRouteFailure, requireWorkerRequest } from "../../../../../src/worker-api";

export async function POST(request: NextRequest) {
  const worker = requireWorkerRequest(request);
  if (isRouteFailure(worker)) {
    return worker.response;
  }

  return NextResponse.json({
    ok: true,
    worker: {
      id: worker.workerId,
    },
    accepted: true,
  });
}
