import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../src/client";
import {
  beginWorkerApiRequest,
  finishWorkerApiRequest,
  insertWorkerApiAuditEvent,
} from "../src/worker-api-requests";

describe("Worker API idempotency requests", () => {
  it("starts a new idempotent Worker API request", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            id: "request-1",
            worker_id: "worker-1",
            run_id: "run-1",
            operation: "progress",
            idempotency_key: "idem-1",
            request_hash: "hash-1",
            response_status: null,
            response_body: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      beginWorkerApiRequest(client, {
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        requestHash: "hash-1",
      }),
    ).resolves.toEqual({
      status: "started",
      request: {
        id: "request-1",
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        requestHash: "hash-1",
      },
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("on conflict"), [
      "worker-1",
      "run-1",
      "progress",
      "idem-1",
      "hash-1",
    ]);
  });

  it("replays a completed request with the same key and hash", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "request-1",
              worker_id: "worker-1",
              run_id: "run-1",
              operation: "progress",
              idempotency_key: "idem-1",
              request_hash: "hash-1",
              response_status: 200,
              response_body: { ok: true },
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(
      beginWorkerApiRequest(client, {
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        requestHash: "hash-1",
      }),
    ).resolves.toEqual({
      status: "replay",
      request: {
        id: "request-1",
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        requestHash: "hash-1",
        responseStatus: 200,
        responseBody: { ok: true },
      },
    });
  });

  it("rejects a reused idempotency key with a different request hash", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "request-1",
              worker_id: "worker-1",
              run_id: "run-1",
              operation: "progress",
              idempotency_key: "idem-1",
              request_hash: "old-hash",
              response_status: 200,
              response_body: { ok: true },
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(
      beginWorkerApiRequest(client, {
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        requestHash: "new-hash",
      }),
    ).resolves.toMatchObject({
      status: "conflict",
      reason: "key_reused_with_different_request",
    });
  });

  it("finishes a request by storing the stable response", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "request-1",
            worker_id: "worker-1",
            run_id: "run-1",
            operation: "progress",
            idempotency_key: "idem-1",
            request_hash: "hash-1",
            response_status: 200,
            response_body: { ok: true },
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      finishWorkerApiRequest(client, {
        requestId: "request-1",
        responseStatus: 200,
        responseBody: { ok: true },
      }),
    ).resolves.toMatchObject({
      responseStatus: 200,
      responseBody: { ok: true },
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("response_body = $3"), [
      "request-1",
      200,
      '{"ok":true}',
    ]);
  });
});

describe("Worker API audit events", () => {
  it("records audit evidence for Worker API writes", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await insertWorkerApiAuditEvent(client, {
      workerId: "worker-1",
      runId: "run-1",
      operation: "progress",
      idempotencyKey: "idem-1",
      responseStatus: 200,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into audit_events"), [
      "worker_api.progress",
      "run-1",
      "Worker API progress request processed.",
      "worker-1",
      "progress",
      "idem-1",
      200,
    ]);
  });
});
