import { NextResponse, type NextRequest } from "next/server";
import { isWorkflowState } from "@agent-control-plane/core";
import { completeRun, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import {
  executeWorkerWrite,
  isRouteFailure,
  optionalString,
  parseJsonObject,
  requiredString,
  requireWorkerRequest,
  requireWorkerWriteSafety,
  resolveRunId,
} from "../../../../../../../src/worker-api";

export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const worker = requireWorkerRequest(request);
  if (isRouteFailure(worker)) {
    return worker.response;
  }

  const runId = await resolveRunId(context.params);
  if (isRouteFailure(runId)) {
    return runId.response;
  }

  const payload = await parseJsonObject(request);
  const resultSummary = requiredString(payload, "resultSummary");
  if (isRouteFailure(resultSummary)) {
    return resultSummary.response;
  }
  const safety = requireWorkerWriteSafety(request, {
    workerId: worker.workerId,
    runId,
    operation: "complete",
    payload,
  });
  if (isRouteFailure(safety)) {
    return safety.response;
  }

  const nextState = optionalString(payload, "nextStateSuggestion");
  if (nextState && !isWorkflowState(nextState)) {
    return NextResponse.json(
      {
        ok: false,
        error: "nextStateSuggestion must be a valid workflow state.",
        reason: "invalid_next_state",
      },
      { status: 400 },
    );
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      executeWorkerWrite(client, safety, async () => {
        const run = await completeRun(client, {
          runId,
          leaseOwner: worker.workerId,
          resultSummary,
          ...(nextState ? { nextState } : {}),
          advanceTaskState: Boolean(nextState),
        });
        if (!run) {
          return {
            status: 409,
            body: {
              ok: false,
              error: "Run lease is not active for this worker.",
              reason: "lease_not_active",
            },
          };
        }

        return {
          status: 200,
          body: { ok: true, run },
        };
      }),
    ),
  );

  if (isRouteFailure(result)) {
    return result.response;
  }

  return NextResponse.json(result.body, { status: result.status });
}
