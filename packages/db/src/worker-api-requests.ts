import type { DatabaseClient } from "./client.js";

export interface BeginWorkerApiRequestInput {
  workerId: string;
  runId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface WorkerApiRequestRecord {
  id: string;
  workerId: string;
  runId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus?: number;
  responseBody?: unknown;
}

export type BeginWorkerApiRequestResult =
  | {
      status: "started";
      request: WorkerApiRequestRecord;
    }
  | {
      status: "replay";
      request: WorkerApiRequestRecord & {
        responseStatus: number;
        responseBody: unknown;
      };
    }
  | {
      status: "conflict";
      reason: "key_reused_with_different_request" | "request_in_progress";
      request: WorkerApiRequestRecord;
    };

interface WorkerApiRequestRow {
  id: string;
  worker_id: string;
  run_id: string;
  operation: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export async function beginWorkerApiRequest(
  client: DatabaseClient,
  input: BeginWorkerApiRequestInput,
): Promise<BeginWorkerApiRequestResult> {
  const inserted = await client.query<WorkerApiRequestRow>(
    `
      insert into worker_api_requests (
        id,
        worker_id,
        run_id,
        operation,
        idempotency_key,
        request_hash,
        created_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        now(),
        now()
      )
      on conflict (worker_id, idempotency_key) do nothing
      returning id, worker_id, run_id, operation, idempotency_key, request_hash, response_status, response_body
    `,
    [input.workerId, input.runId, input.operation, input.idempotencyKey, input.requestHash],
  );

  const insertedRecord = mapWorkerApiRequestRow(inserted.rows[0]);
  if (insertedRecord) {
    return {
      status: "started",
      request: insertedRecord,
    };
  }

  const existing = await fetchWorkerApiRequestByKey(client, input.workerId, input.idempotencyKey);
  if (!existing) {
    throw new Error("Worker API idempotency insert conflicted but no existing request was found.");
  }

  if (existing.requestHash !== input.requestHash) {
    return {
      status: "conflict",
      reason: "key_reused_with_different_request",
      request: existing,
    };
  }

  if (existing.responseStatus === undefined) {
    return {
      status: "conflict",
      reason: "request_in_progress",
      request: existing,
    };
  }

  return {
    status: "replay",
    request: {
      ...existing,
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
    },
  };
}

export async function finishWorkerApiRequest(
  client: DatabaseClient,
  input: {
    requestId: string;
    responseStatus: number;
    responseBody: unknown;
  },
): Promise<WorkerApiRequestRecord | undefined> {
  const result = await client.query<WorkerApiRequestRow>(
    `
      update worker_api_requests
      set
        response_status = $2,
        response_body = $3,
        updated_at = now()
      where id = $1
      returning id, worker_id, run_id, operation, idempotency_key, request_hash, response_status, response_body
    `,
    [input.requestId, input.responseStatus, JSON.stringify(input.responseBody)],
  );

  return mapWorkerApiRequestRow(result.rows[0]);
}

export async function insertWorkerApiAuditEvent(
  client: DatabaseClient,
  input: {
    workerId: string;
    runId: string;
    operation: string;
    idempotencyKey?: string;
    responseStatus: number;
    message?: string;
  },
): Promise<void> {
  await client.query(
    `
      insert into audit_events (
        id,
        action,
        entity_type,
        entity_id,
        message,
        payload,
        created_at
      )
      values (
        gen_random_uuid(),
        $1,
        'run',
        $2,
        $3,
        jsonb_build_object(
          'workerId', $4::text,
          'operation', $5::text,
          'idempotencyKey', $6::text,
          'responseStatus', $7::integer
        ),
        now()
      )
    `,
    [
      `worker_api.${input.operation}`,
      input.runId,
      input.message ?? `Worker API ${input.operation} request processed.`,
      input.workerId,
      input.operation,
      input.idempotencyKey ?? null,
      input.responseStatus,
    ],
  );
}

async function fetchWorkerApiRequestByKey(
  client: DatabaseClient,
  workerId: string,
  idempotencyKey: string,
): Promise<WorkerApiRequestRecord | undefined> {
  const result = await client.query<WorkerApiRequestRow>(
    `
      select id, worker_id, run_id, operation, idempotency_key, request_hash, response_status, response_body
      from worker_api_requests
      where worker_id = $1
        and idempotency_key = $2
      limit 1
    `,
    [workerId, idempotencyKey],
  );

  return mapWorkerApiRequestRow(result.rows[0]);
}

function mapWorkerApiRequestRow(
  row: WorkerApiRequestRow | undefined,
): WorkerApiRequestRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    workerId: row.worker_id,
    runId: row.run_id,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    ...(row.response_status !== null ? { responseStatus: row.response_status } : {}),
    ...(row.response_body !== null ? { responseBody: row.response_body } : {}),
  };
}
