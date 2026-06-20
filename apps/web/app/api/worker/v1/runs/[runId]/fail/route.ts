import { NextResponse, type NextRequest } from "next/server";
import { failRun, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import {
  executeWorkerWrite,
  isRouteFailure,
  optionalBoolean,
  parseJsonObject,
  requireActiveLease,
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
  const failureReason = requiredString(payload, "failureReason");
  if (isRouteFailure(failureReason)) {
    return failureReason.response;
  }
  const safety = requireWorkerWriteSafety(request, {
    workerId: worker.workerId,
    runId,
    operation: "fail",
    payload,
  });
  if (isRouteFailure(safety)) {
    return safety.response;
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      executeWorkerWrite(client, safety, async () => {
        const lease = await requireActiveLease(client, runId, worker.workerId);
        if (isRouteFailure(lease)) {
          return {
            status: 409,
            body: {
              ok: false,
              error: "Run lease is not active for this worker.",
              reason: "lease_not_active",
            },
          };
        }

        const run = await failRun(client, {
          runId,
          leaseOwner: worker.workerId,
          failureReason,
          retryable: optionalBoolean(payload, "retryable") ?? true,
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
