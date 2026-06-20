import { NextResponse, type NextRequest } from "next/server";
import { workerApiOpenApiDocument } from "@agent-control-plane/core";
import { isRouteFailure, requireWorkerRequest } from "../../../../../src/worker-api";

export async function GET(request: NextRequest) {
  const worker = requireWorkerRequest(request);
  if (isRouteFailure(worker)) {
    return worker.response;
  }

  return NextResponse.json(workerApiOpenApiDocument);
}
