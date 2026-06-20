import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  beginWorkerApiRequest: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  finishWorkerApiRequest: vi.fn(),
  heartbeatRun: vi.fn(),
  insertWorkerApiAuditEvent: vi.fn(),
  insertRunEvents: vi.fn(),
  recordTaskProgress: vi.fn(),
  verifyRunLease: vi.fn(),
  withDatabasePool: vi.fn(async (callback: (pool: unknown) => Promise<unknown>) =>
    callback({ pool: true }),
  ),
  withTransaction: vi.fn(async (_pool: unknown, callback: (client: unknown) => Promise<unknown>) =>
    callback({ transaction: true }),
  ),
}));

vi.mock("@agent-control-plane/db", () => db);

const routeContext = {
  params: Promise.resolve({
    runId: "run-1",
  }),
};

function jsonRequest(
  payload: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextRequest {
  return new Request("http://control-plane.test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer worker-token",
      "x-acp-worker-id": "worker-1",
      "idempotency-key": "idem-1",
      ...headers,
    },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

describe("Worker API routes", () => {
  beforeEach(() => {
    process.env.ACP_WORKER_API_TOKEN = "worker-token";
    delete process.env.ACP_WORKER_API_RATE_LIMIT_PER_MINUTE;
    db.beginWorkerApiRequest.mockReset();
    db.completeRun.mockReset();
    db.failRun.mockReset();
    db.finishWorkerApiRequest.mockReset();
    db.heartbeatRun.mockReset();
    db.insertWorkerApiAuditEvent.mockReset();
    db.insertRunEvents.mockReset();
    db.recordTaskProgress.mockReset();
    db.verifyRunLease.mockReset();
    db.withDatabasePool.mockClear();
    db.withTransaction.mockClear();
    db.beginWorkerApiRequest.mockResolvedValue({
      status: "started",
      request: {
        id: "worker-api-request-1",
        workerId: "worker-1",
        runId: "run-1",
        operation: "test",
        idempotencyKey: "idem-1",
        requestHash: "hash",
      },
    });
    db.finishWorkerApiRequest.mockResolvedValue({
      id: "worker-api-request-1",
      workerId: "worker-1",
      runId: "run-1",
      operation: "test",
      idempotencyKey: "idem-1",
      requestHash: "hash",
      responseStatus: 200,
      responseBody: { ok: true },
    });
    db.insertWorkerApiAuditEvent.mockResolvedValue(undefined);
  });

  it("registers an authenticated worker", async () => {
    const route = await import("../app/api/worker/v1/register/route");
    const response = await route.POST(jsonRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      worker: { id: "worker-1" },
      accepted: true,
    });
  });

  it("serves the authenticated OpenAPI contract", async () => {
    const route = await import("../app/api/worker/v1/openapi.json/route");
    const response = await route.GET(jsonRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.openapi).toBe("3.1.0");
    expect(payload.paths).toHaveProperty("/api/worker/v1/runs/claim");
    expect(payload.paths).toHaveProperty("/api/worker/v1/runs/{runId}/complete");
    expect(payload.components.parameters.workerId.required).toBe(true);
  });

  it("rejects route access when worker id is missing", async () => {
    const route = await import("../app/api/worker/v1/register/route");
    const response = await route.POST(
      new Request("http://control-plane.test", {
        method: "POST",
        headers: {
          authorization: "Bearer worker-token",
        },
      }) as unknown as NextRequest,
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.reason).toBe("missing_worker_id");
  });

  it("records heartbeat and can extend the lease", async () => {
    db.heartbeatRun.mockResolvedValue({
      runId: "run-1",
      taskId: "task-1",
      status: "running",
      heartbeatAt: new Date("2026-06-20T10:00:00Z"),
    });

    const route = await import("../app/api/worker/v1/runs/[runId]/heartbeat/route");
    const response = await route.POST(jsonRequest({ leaseTtlMs: 60000 }), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(db.heartbeatRun).toHaveBeenCalledWith(
      expect.any(Object),
      "run-1",
      "worker-1",
      expect.any(Date),
    );
  });

  it("requires an active lease before recording progress", async () => {
    db.verifyRunLease.mockResolvedValue({
      runId: "run-1",
      taskId: "task-1",
      status: "running",
      leaseOwner: "worker-1",
    });
    db.recordTaskProgress.mockResolvedValue({
      inserted: true,
      taskId: "task-1",
      progressId: "progress-1",
    });

    const route = await import("../app/api/worker/v1/runs/[runId]/progress/route");
    const response = await route.POST(jsonRequest({ body: "完成棋盘 UI" }), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.progress).toEqual({
      inserted: true,
      taskId: "task-1",
      progressId: "progress-1",
    });
    expect(db.recordTaskProgress).toHaveBeenCalledWith(expect.any(Object), {
      taskId: "task-1",
      runId: "run-1",
      body: "完成棋盘 UI",
    });
    expect(db.beginWorkerApiRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
      }),
    );
    expect(db.finishWorkerApiRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        requestId: "worker-api-request-1",
        responseStatus: 200,
      }),
    );
    expect(db.insertWorkerApiAuditEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        responseStatus: 200,
      }),
    );
  });

  it("requires idempotency keys for run write commands", async () => {
    const route = await import("../app/api/worker/v1/runs/[runId]/progress/route");
    const response = await route.POST(
      jsonRequest(
        { body: "still working" },
        {
          "idempotency-key": "",
        },
      ),
      routeContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.reason).toBe("missing_idempotency_key");
    expect(db.beginWorkerApiRequest).not.toHaveBeenCalled();
  });

  it("replays stored idempotent responses without executing the write again", async () => {
    db.beginWorkerApiRequest.mockResolvedValue({
      status: "replay",
      request: {
        id: "worker-api-request-1",
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        requestHash: "hash",
        responseStatus: 200,
        responseBody: {
          ok: true,
          progress: {
            inserted: true,
            taskId: "task-1",
            progressId: "progress-1",
          },
        },
      },
    });

    const route = await import("../app/api/worker/v1/runs/[runId]/progress/route");
    const response = await route.POST(jsonRequest({ body: "完成棋盘 UI" }), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.progress.progressId).toBe("progress-1");
    expect(db.verifyRunLease).not.toHaveBeenCalled();
    expect(db.recordTaskProgress).not.toHaveBeenCalled();
  });

  it("rejects idempotency key reuse with a different request", async () => {
    db.beginWorkerApiRequest.mockResolvedValue({
      status: "conflict",
      reason: "key_reused_with_different_request",
      request: {
        id: "worker-api-request-1",
        workerId: "worker-1",
        runId: "run-1",
        operation: "progress",
        idempotencyKey: "idem-1",
        requestHash: "old-hash",
      },
    });

    const route = await import("../app/api/worker/v1/runs/[runId]/progress/route");
    const response = await route.POST(jsonRequest({ body: "new body" }), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.reason).toBe("key_reused_with_different_request");
    expect(db.recordTaskProgress).not.toHaveBeenCalled();
  });

  it("rate limits Worker API writes per worker and operation", async () => {
    process.env.ACP_WORKER_API_RATE_LIMIT_PER_MINUTE = "1";
    db.verifyRunLease.mockResolvedValue({
      runId: "run-1",
      taskId: "task-1",
      status: "running",
      leaseOwner: "rate-worker",
    });
    db.recordTaskProgress.mockResolvedValue({
      inserted: true,
      taskId: "task-1",
      progressId: "progress-1",
    });

    const route = await import("../app/api/worker/v1/runs/[runId]/progress/route");
    const first = await route.POST(
      jsonRequest(
        { body: "first" },
        {
          "x-acp-worker-id": "rate-worker",
          "idempotency-key": "rate-1",
        },
      ),
      routeContext,
    );
    const second = await route.POST(
      jsonRequest(
        { body: "second" },
        {
          "x-acp-worker-id": "rate-worker",
          "idempotency-key": "rate-2",
        },
      ),
      routeContext,
    );
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    expect(secondPayload.reason).toBe("rate_limited");
  });

  it("rejects progress updates when the lease is not active", async () => {
    db.verifyRunLease.mockResolvedValue(undefined);

    const route = await import("../app/api/worker/v1/runs/[runId]/progress/route");
    const response = await route.POST(jsonRequest({ body: "still working" }), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.reason).toBe("lease_not_active");
    expect(db.recordTaskProgress).not.toHaveBeenCalled();
  });

  it("records artifacts as run events", async () => {
    db.verifyRunLease.mockResolvedValue({
      runId: "run-1",
      taskId: "task-1",
      status: "running",
      leaseOwner: "worker-1",
    });
    db.insertRunEvents.mockResolvedValue([
      {
        id: "event-1",
        eventType: "worker.artifacts",
        message: "Worker reported artifacts.",
        payload: { files: ["dist/index.js"] },
        createdAt: new Date("2026-06-20T10:00:00Z"),
      },
    ]);

    const route = await import("../app/api/worker/v1/runs/[runId]/artifacts/route");
    const response = await route.POST(jsonRequest({ files: ["dist/index.js"] }), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.events).toHaveLength(1);
    expect(db.insertRunEvents).toHaveBeenCalledWith(expect.any(Object), "run-1", [
      {
        eventType: "worker.artifacts",
        message: "Worker reported artifacts.",
        payload: { files: ["dist/index.js"] },
      },
    ]);
  });

  it("completes a run and advances task state from the worker suggestion", async () => {
    db.completeRun.mockResolvedValue({
      runId: "run-1",
      taskId: "task-1",
      status: "succeeded",
      nextState: "Code Review",
    });

    const route = await import("../app/api/worker/v1/runs/[runId]/complete/route");
    const response = await route.POST(
      jsonRequest({
        resultSummary: "实现完成",
        nextStateSuggestion: "Code Review",
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(db.completeRun).toHaveBeenCalledWith(expect.any(Object), {
      runId: "run-1",
      leaseOwner: "worker-1",
      resultSummary: "实现完成",
      nextState: "Code Review",
      advanceTaskState: true,
    });
  });

  it("rejects invalid worker next state suggestions before completing the run", async () => {
    const route = await import("../app/api/worker/v1/runs/[runId]/complete/route");
    const response = await route.POST(
      jsonRequest({
        resultSummary: "实现完成",
        nextStateSuggestion: "Ready To Merge",
      }),
      routeContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.reason).toBe("invalid_next_state");
    expect(db.completeRun).not.toHaveBeenCalled();
    expect(db.beginWorkerApiRequest).not.toHaveBeenCalled();
  });

  it("fails a run after lease verification", async () => {
    db.verifyRunLease.mockResolvedValue({
      runId: "run-1",
      taskId: "task-1",
      status: "running",
      leaseOwner: "worker-1",
    });
    db.failRun.mockResolvedValue({
      runId: "run-1",
      taskId: "task-1",
      status: "failed",
    });

    const route = await import("../app/api/worker/v1/runs/[runId]/fail/route");
    const response = await route.POST(
      jsonRequest({
        failureReason: "测试失败",
        retryable: false,
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(db.failRun).toHaveBeenCalledWith(expect.any(Object), {
      runId: "run-1",
      leaseOwner: "worker-1",
      failureReason: "测试失败",
      retryable: false,
    });
  });
});
