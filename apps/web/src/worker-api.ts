import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { DatabaseClient, RunLeaseRecord } from "@agent-control-plane/db";
import {
  beginWorkerApiRequest,
  finishWorkerApiRequest,
  insertWorkerApiAuditEvent,
  verifyRunLease,
} from "@agent-control-plane/db";
import {
  authorizeWorkerApiRequest,
  workerAuthErrorMessage,
  type WorkerApiAuthEnv,
} from "./worker-auth";

export interface WorkerRequestContext {
  workerId: string;
}

export interface RouteFailure {
  response: NextResponse;
}

export interface WorkerWriteSafetyContext {
  workerId: string;
  runId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface WorkerWriteResult {
  status: number;
  body: Record<string, unknown>;
}

export interface WorkerApiRateLimitEnv extends WorkerApiAuthEnv {
  ACP_WORKER_API_RATE_LIMIT_PER_MINUTE?: string;
}

const workerApiRateLimitBuckets = new Map<string, number[]>();

export function requireWorkerRequest(
  request: NextRequest | Request,
  env: WorkerApiAuthEnv = process.env,
): WorkerRequestContext | RouteFailure {
  const authorization = authorizeWorkerApiRequest(request, env);
  if (!authorization.ok) {
    return {
      response: NextResponse.json(
        {
          ok: false,
          error: workerAuthErrorMessage(authorization.reason),
          reason: authorization.reason,
        },
        { status: 401 },
      ),
    };
  }

  if (!authorization.workerId) {
    return {
      response: NextResponse.json(
        {
          ok: false,
          error: "Worker id is required.",
          reason: "missing_worker_id",
        },
        { status: 401 },
      ),
    };
  }

  return { workerId: authorization.workerId };
}

export async function parseJsonObject(
  request: NextRequest | Request,
): Promise<Record<string, unknown>> {
  if (request.headers.get("content-length") === "0") {
    return {};
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {};
  }

  const payload = (await request.json().catch(() => undefined)) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload as Record<string, unknown>;
}

export async function resolveRunId(
  params: Promise<{ runId: string }> | { runId: string },
): Promise<string | RouteFailure> {
  const value = "then" in params ? await params : params;
  const runId = normalizeString(value.runId);
  if (!runId) {
    return {
      response: NextResponse.json(
        { ok: false, error: "runId is required.", reason: "missing_run_id" },
        { status: 400 },
      ),
    };
  }

  return runId;
}

export async function requireActiveLease(
  client: DatabaseClient,
  runId: string,
  workerId: string,
): Promise<RunLeaseRecord | RouteFailure> {
  const lease = await verifyRunLease(client, runId, workerId);
  if (!lease) {
    return {
      response: NextResponse.json(
        {
          ok: false,
          error: "Run lease is not active for this worker.",
          reason: "lease_not_active",
        },
        { status: 409 },
      ),
    };
  }

  return lease;
}

export function requireWorkerWriteSafety(
  request: NextRequest | Request,
  input: {
    workerId: string;
    runId: string;
    operation: string;
    payload: Record<string, unknown>;
  },
  env: WorkerApiRateLimitEnv = process.env,
): WorkerWriteSafetyContext | RouteFailure {
  const rateLimit = enforceWorkerApiRateLimit(input.workerId, input.operation, env);
  if (isRouteFailure(rateLimit)) {
    return rateLimit;
  }

  const idempotencyKey = extractIdempotencyKey(request.headers);
  if (!idempotencyKey) {
    return {
      response: NextResponse.json(
        {
          ok: false,
          error: "Idempotency key is required.",
          reason: "missing_idempotency_key",
        },
        { status: 400 },
      ),
    };
  }

  return {
    ...input,
    idempotencyKey,
    requestHash: hashWorkerWriteRequest(input),
  };
}

export async function executeWorkerWrite(
  client: DatabaseClient,
  context: WorkerWriteSafetyContext,
  callback: () => Promise<WorkerWriteResult>,
): Promise<WorkerWriteResult | RouteFailure> {
  const request = await beginWorkerApiRequest(client, context);

  if (request.status === "replay") {
    return {
      response: NextResponse.json(request.request.responseBody, {
        status: request.request.responseStatus,
      }),
    };
  }

  if (request.status === "conflict") {
    return {
      response: NextResponse.json(
        {
          ok: false,
          error:
            request.reason === "request_in_progress"
              ? "Worker API request is still in progress."
              : "Idempotency key was reused with a different request.",
          reason: request.reason,
        },
        { status: 409 },
      ),
    };
  }

  const result = await callback();
  const responseBody = toJsonSafe(result.body);
  await finishWorkerApiRequest(client, {
    requestId: request.request.id,
    responseStatus: result.status,
    responseBody,
  });
  await insertWorkerApiAuditEvent(client, {
    workerId: context.workerId,
    runId: context.runId,
    operation: context.operation,
    idempotencyKey: context.idempotencyKey,
    responseStatus: result.status,
  });

  return {
    status: result.status,
    body: responseBody,
  };
}

export function isRouteFailure<T>(value: T | RouteFailure): value is RouteFailure {
  return (
    value !== null &&
    typeof value === "object" &&
    "response" in value &&
    value.response instanceof NextResponse
  );
}

export function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  return normalizeString(payload[key]);
}

export function requiredString(
  payload: Record<string, unknown>,
  key: string,
): string | RouteFailure {
  const value = optionalString(payload, key);
  if (!value) {
    return {
      response: NextResponse.json(
        { ok: false, error: `${key} is required.`, reason: "invalid_request" },
        { status: 400 },
      ),
    };
  }

  return value;
}

export function optionalPositiveInteger(
  payload: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const integer = Math.trunc(value);
  return integer > 0 ? integer : undefined;
}

export function optionalNonNegativeNumber(
  payload: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

export function optionalBoolean(
  payload: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

export function optionalDate(payload: Record<string, unknown>, key: string): Date | undefined {
  const value = optionalString(payload, key);
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractIdempotencyKey(headers: Pick<Headers, "get">): string | undefined {
  return (
    normalizeString(headers.get("idempotency-key")) ??
    normalizeString(headers.get("x-idempotency-key"))
  );
}

function enforceWorkerApiRateLimit(
  workerId: string,
  operation: string,
  env: WorkerApiRateLimitEnv,
): true | RouteFailure {
  const limit = normalizeRateLimit(env.ACP_WORKER_API_RATE_LIMIT_PER_MINUTE);
  if (!limit) {
    return true;
  }

  const now = Date.now();
  const bucketKey = `${workerId}:${operation}`;
  const windowStartedAt = now - 60_000;
  const bucket = (workerApiRateLimitBuckets.get(bucketKey) ?? []).filter(
    (timestamp) => timestamp > windowStartedAt,
  );

  if (bucket.length >= limit) {
    workerApiRateLimitBuckets.set(bucketKey, bucket);
    const oldestRequestAt = bucket[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestRequestAt + 60_000 - now) / 1000));
    return {
      response: NextResponse.json(
        {
          ok: false,
          error: "Worker API rate limit exceeded.",
          reason: "rate_limited",
          retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "retry-after": String(retryAfterSeconds),
          },
        },
      ),
    };
  }

  bucket.push(now);
  workerApiRateLimitBuckets.set(bucketKey, bucket);
  return true;
}

function normalizeRateLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "120", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function hashWorkerWriteRequest(input: {
  workerId: string;
  runId: string;
  operation: string;
  payload: Record<string, unknown>;
}): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function toJsonSafe(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
