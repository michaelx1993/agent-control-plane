import { NextResponse, type NextRequest } from "next/server";
import {
  insertRunEvents,
  upsertConversationRef,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import {
  executeWorkerWrite,
  isRouteFailure,
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
  const safety = requireWorkerWriteSafety(request, {
    workerId: worker.workerId,
    runId,
    operation: "artifacts",
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

        const events = await insertRunEvents(client, runId, [
          {
            eventType: "worker.artifacts",
            message: "Worker reported artifacts.",
            payload,
          },
        ]);

        const conversation = extractConversationRef(payload);
        if (conversation) {
          await upsertConversationRef(client, {
            runId,
            ...conversation,
          });
        }

        return {
          status: 200,
          body: { ok: true, events },
        };
      }),
    ),
  );

  if (isRouteFailure(result)) {
    return result.response;
  }

  return NextResponse.json(result.body, { status: result.status });
}

function extractConversationRef(payload: Record<string, unknown>):
  | {
      provider: string;
      conversationId: string;
      eventLogUri?: string;
      eventCursor?: string;
      uiUrl?: string;
    }
  | undefined {
  const conversation = payload.conversation;
  if (!conversation || typeof conversation !== "object" || Array.isArray(conversation)) {
    return undefined;
  }

  const record = conversation as Record<string, unknown>;
  const provider = stringValue(record.provider);
  const conversationId = stringValue(record.conversationId);
  if (!provider || !conversationId) {
    return undefined;
  }

  const eventLogUri = stringValue(record.eventLogUri);
  const eventCursor = stringValue(record.eventCursor);
  const uiUrl = stringValue(record.uiUrl);

  return {
    provider,
    conversationId,
    ...(eventLogUri ? { eventLogUri } : {}),
    ...(eventCursor ? { eventCursor } : {}),
    ...(uiUrl ? { uiUrl } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
