import {
  decideDispatch,
  type ActiveRunSnapshot,
  type RepositoryRef,
  type TaskSnapshot,
} from "@agent-control-plane/core";
import { NextResponse } from "next/server";

interface DispatchPreviewRequest {
  task: TaskSnapshot;
  repositories: RepositoryRef[];
  activeRuns?: ActiveRunSnapshot[];
}

export async function POST(request: Request) {
  const payload = (await request.json()) as DispatchPreviewRequest;

  return NextResponse.json(
    decideDispatch(payload.task, payload.repositories, payload.activeRuns ?? []),
  );
}
