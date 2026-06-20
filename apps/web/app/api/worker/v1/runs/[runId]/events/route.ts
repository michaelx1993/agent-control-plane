import { NextResponse, type NextRequest } from "next/server";
import {
  type DatabaseClient,
  insertRunEvents,
  recordWorkspaceReady,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
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
        await recordWorkspaceReadyEvents(client, runId, events);
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

async function recordWorkspaceReadyEvents(
  client: DatabaseClient,
  runId: string,
  events: Array<{ eventType: string; payload: unknown }>,
) {
  for (const event of events) {
    if (event.eventType !== "workspace.ready") {
      continue;
    }

    const workspace = normalizeWorkspaceReadyPayload(event.payload);
    if (!workspace) {
      continue;
    }

    await recordWorkspaceReady(client, {
      runId,
      ...workspace,
    });
  }
}

function normalizeWorkspaceReadyPayload(payload: unknown):
  | {
      strategy: string;
      path: string;
      baseRef?: string;
      headRef?: string;
    }
  | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const strategy = normalizeString(record.strategy);
  const path = normalizeString(record.path);
  if (!strategy || !path) {
    return undefined;
  }

  const workspace: {
    strategy: string;
    path: string;
    baseRef?: string;
    headRef?: string;
  } = {
    strategy,
    path,
  };
  const baseRef = normalizeString(record.baseRef);
  const headRef = normalizeString(record.headRef);
  if (baseRef) {
    workspace.baseRef = baseRef;
  }
  if (headRef) {
    workspace.headRef = headRef;
  }

  return workspace;
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
