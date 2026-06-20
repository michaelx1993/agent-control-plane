import { NextResponse, type NextRequest } from "next/server";
import { insertRunEvents, withDatabasePool, withTransaction } from "@agent-control-plane/db";
import {
  executeWorkerWrite,
  isRouteFailure,
  normalizeString,
  parseJsonObject,
  requireActiveLease,
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
  const events = normalizeEvents(payload.events);
  if (events.length === 0) {
    return NextResponse.json(
      { ok: false, error: "events are required.", reason: "invalid_request" },
      { status: 400 },
    );
  }
  const safety = requireWorkerWriteSafety(request, {
    workerId: worker.workerId,
    runId,
    operation: "events",
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

        const inserted = await insertRunEvents(client, runId, events);
        return {
          status: 200,
          body: { ok: true, events: inserted },
        };
      }),
    ),
  );

  if (isRouteFailure(result)) {
    return result.response;
  }

  return NextResponse.json(result.body, { status: result.status });
}

function normalizeEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const eventType = normalizeString(record.eventType);
      const message = normalizeString(record.message);
      if (!eventType || !message) {
        return undefined;
      }
      return {
        eventType,
        message,
        payload: record.payload,
      };
    })
    .filter((event): event is { eventType: string; message: string; payload: unknown } =>
      Boolean(event),
    );
}
