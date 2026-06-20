import {
  insertPlaneCommentFeedback,
  syncExternalTasks,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import {
  extractPlaneCommentBody,
  extractPlaneIssueId,
  fetchPlaneTaskSyncRecords,
  loadPlaneConfig,
  parsePlaneWebhook,
  verifyPlaneWebhookSignature,
} from "@agent-control-plane/plane";
import { NextResponse } from "next/server";

interface PlaneWebhookResponse {
  accepted: boolean;
  eventName?: string;
  synced?: number;
  feedbackInserted?: boolean;
  skippedReason?: string;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.PLANE_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return NextResponse.json<PlaneWebhookResponse>(
      { accepted: false, skippedReason: "missing_webhook_secret" },
      { status: 503 },
    );
  }

  if (!verifyPlaneWebhookSignature(rawBody, request.headers.get("x-plane-signature"), secret)) {
    return NextResponse.json<PlaneWebhookResponse>(
      { accepted: false, skippedReason: "invalid_signature" },
      { status: 401 },
    );
  }

  const envelope = parsePlaneWebhook(rawBody, request.headers.get("x-plane-event"));
  const eventName = envelope.eventName.toLowerCase();

  if (eventName.includes("comment")) {
    const result = await ingestPlaneComment(envelope.payload);
    const response: PlaneWebhookResponse = {
      accepted: true,
      eventName: envelope.eventName,
      feedbackInserted: result.inserted,
    };

    if (result.reason) {
      response.skippedReason = result.reason;
    }

    return NextResponse.json<PlaneWebhookResponse>(response);
  }

  if (eventName.includes("issue")) {
    const synced = await syncPlaneTasksFromApi();
    return NextResponse.json<PlaneWebhookResponse>({
      accepted: true,
      eventName: envelope.eventName,
      synced,
    });
  }

  return NextResponse.json<PlaneWebhookResponse>({
    accepted: true,
    eventName: envelope.eventName,
    skippedReason: "event_ignored",
  });
}

async function syncPlaneTasksFromApi(): Promise<number> {
  const config = loadPlaneConfig();
  const records = await fetchPlaneTaskSyncRecords(config);

  await withDatabasePool((pool) =>
    withTransaction(pool, (transaction) =>
      syncExternalTasks(transaction, {
        projectSlug: config.projectSlug,
        tasks: records,
      }),
    ),
  );

  return records.length;
}

async function ingestPlaneComment(payload: unknown) {
  const externalTaskId = extractPlaneIssueId(payload);
  const body = extractPlaneCommentBody(payload);

  if (!externalTaskId || !body) {
    return {
      inserted: false,
      reason: "missing_issue_or_body",
    };
  }

  return withDatabasePool((pool) =>
    withTransaction(pool, (transaction) =>
      insertPlaneCommentFeedback(transaction, {
        externalTaskId,
        body,
      }),
    ),
  );
}
