import { NextResponse, type NextRequest } from "next/server";
import { heartbeatRun, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import {
  executeWorkerWrite,
  isRouteFailure,
  optionalDate,
  optionalPositiveInteger,
  parseJsonObject,
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
  const safety = requireWorkerWriteSafety(request, {
    workerId: worker.workerId,
    runId,
    operation: "heartbeat",
    payload,
  });
  if (isRouteFailure(safety)) {
    return safety.response;
  }

  const leaseTtlMs = optionalPositiveInteger(payload, "leaseTtlMs");
  const explicitLeaseExpiresAt = optionalDate(payload, "leaseExpiresAt");
  const leaseExpiresAt =
    explicitLeaseExpiresAt ?? (leaseTtlMs ? new Date(Date.now() + leaseTtlMs) : undefined);
  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      executeWorkerWrite(client, safety, async () => {
        const run = await heartbeatRun(client, runId, worker.workerId, leaseExpiresAt);
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
