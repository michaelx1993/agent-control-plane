import { describe, expect, it } from "vitest";

import {
  isDispatchableTaskCandidate,
  markExpiredLeasesFailed,
  markRunRunning,
  recordRunObservabilityRefs,
} from "./query.js";
import type { DbClient } from "./query.js";

describe("isDispatchableTaskCandidate", () => {
  it("rejects tasks without a repository", () => {
    expect(
      isDispatchableTaskCandidate({
        repositoryId: null,
        state: "Development",
        repository: null,
        runs: [],
      }),
    ).toBe(false);
  });

  it("accepts dispatchable tasks with an active repository and no live run", () => {
    expect(
      isDispatchableTaskCandidate({
        repositoryId: "f7130d60-4fd2-4d6f-8f22-31c828a93e17",
        state: "Development",
        repository: { status: "active" },
        runs: [],
      }),
    ).toBe(true);
  });

  it("marks expired claimed/running leases as failed and records events", async () => {
    const now = new Date("2026-06-18T17:00:00.000Z");
    const expiredAt = new Date("2026-06-18T16:59:00.000Z");
    const runUpdateCalls: unknown[] = [];
    const eventCreateCalls: unknown[] = [];
    const db = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          run: {
            findMany: async () => [
              {
                id: "run-1",
                leaseOwner: "worker-1",
                leaseExpiresAt: expiredAt,
              },
            ],
            update: async (input: unknown) => {
              runUpdateCalls.push(input);
              return {};
            },
          },
          runEvent: {
            create: async (input: unknown) => {
              eventCreateCalls.push(input);
              return {};
            },
          },
        });
      },
    } as unknown as DbClient;

    const result = await markExpiredLeasesFailed(db, { now });

    expect(result).toEqual({ count: 1, runIds: ["run-1"] });
    expect(runUpdateCalls).toEqual([
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "failed",
          leaseExpiresAt: null,
          finishedAt: now,
          failureReason: "Lease expired without heartbeat",
        }),
      }),
    ]);
    expect(eventCreateCalls).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          runId: "run-1",
          eventType: "failed",
          message: "Lease expired without heartbeat",
          payload: {
            leaseOwner: "worker-1",
            expiredAt: expiredAt.toISOString(),
          },
        }),
      }),
    ]);
  });

  it("records OpenHands conversation and Langfuse trace refs for a run", async () => {
    const conversationUpsert = viLike();
    const traceCreate = viLike();
    const eventCreate = viLike();
    const db = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          run: {
            findUnique: async () => ({
              id: "run-1",
              promptReleaseId: "prompt-release-1",
            }),
          },
          conversationRef: {
            upsert: async (input: unknown) => {
              conversationUpsert(input);
              return { id: "conversation-ref-1" };
            },
          },
          traceRef: {
            findFirst: async () => null,
            create: async (input: unknown) => {
              traceCreate(input);
              return { id: "trace-ref-1" };
            },
          },
          runEvent: {
            create: async (input: unknown) => {
              eventCreate(input);
              return {};
            },
          },
        });
      },
    } as unknown as DbClient;

    const result = await recordRunObservabilityRefs(db, {
      runId: "run-1",
      conversationId: "conversation-1",
      conversationUrl: "https://openhands.test/conversations/conversation-1",
      eventCursor: "42",
      traceId: "trace-1",
      traceUrl: "https://langfuse.test/trace-1",
      model: "gpt-5.5 medium",
      inputTokens: 100,
      outputTokens: 25,
      costUsd: 0.03,
      latencyMs: 1234,
    });

    expect(result).toEqual({
      conversationRef: { id: "conversation-ref-1" },
      traceRef: { id: "trace-ref-1" },
    });
    expect(conversationUpsert.calls[0]).toEqual(
      expect.objectContaining({
        where: { runId: "run-1" },
        create: expect.objectContaining({
          runId: "run-1",
          conversationId: "conversation-1",
          eventCursor: "42",
          uiUrl: "https://openhands.test/conversations/conversation-1",
        }),
      }),
    );
    expect(traceCreate.calls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: "run-1",
          traceId: "trace-1",
          promptReleaseId: "prompt-release-1",
          model: "gpt-5.5 medium",
          inputTokens: 100n,
          outputTokens: 25n,
          costUsd: 0.03,
          latencyMs: 1234,
          uiUrl: "https://langfuse.test/trace-1",
        }),
      }),
    );
    expect(eventCreate.calls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: "run-1",
          eventType: "state_sync",
          message: "Recorded OpenHands conversation and Langfuse trace refs",
        }),
      }),
    );
  });

  it("stores prompt release component composition when a run starts running", async () => {
    const promptReleaseUpdate = viLike();
    const componentDeleteMany = viLike();
    const componentCreateMany = viLike();
    const runUpdate = viLike();
    const eventCreate = viLike();
    const db = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          run: {
            findUnique: async () => ({
              id: "run-1",
              promptReleaseId: "prompt-release-1",
            }),
            update: async (input: unknown) => {
              runUpdate(input);
              return {
                id: "run-1",
                promptReleaseId: "prompt-release-1",
              };
            },
          },
          promptRelease: {
            update: async (input: unknown) => {
              promptReleaseUpdate(input);
              return {};
            },
          },
          promptReleaseComponent: {
            deleteMany: async (input: unknown) => {
              componentDeleteMany(input);
              return {};
            },
            createMany: async (input: unknown) => {
              componentCreateMany(input);
              return {};
            },
          },
          runEvent: {
            create: async (input: unknown) => {
              eventCreate(input);
              return {};
            },
          },
        });
      },
    } as unknown as DbClient;

    await markRunRunning(db, {
      runId: "run-1",
      leaseOwner: "worker-1",
      renderedPrompt: "rendered prompt",
      components: [
        {
          promptComponentId: "component-1",
          orderIndex: 0,
          contentHash: "hash-1",
        },
      ],
    });

    expect(promptReleaseUpdate.calls[0]).toEqual(
      expect.objectContaining({
        where: { id: "prompt-release-1" },
        data: expect.objectContaining({
          renderedContent: "rendered prompt",
        }),
      }),
    );
    expect(componentDeleteMany.calls[0]).toEqual({
      where: { promptReleaseId: "prompt-release-1" },
    });
    expect(componentCreateMany.calls[0]).toEqual({
      data: [
        {
          promptReleaseId: "prompt-release-1",
          promptComponentId: "component-1",
          orderIndex: 0,
          contentHash: "hash-1",
        },
      ],
    });
    expect(runUpdate.calls[0]).toEqual(
      expect.objectContaining({
        where: {
          id: "run-1",
          leaseOwner: "worker-1",
          status: { in: ["claimed", "running"] },
        },
      }),
    );
    expect(eventCreate.calls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: "run-1",
          eventType: "heartbeat",
        }),
      }),
    );
  });
});

function viLike() {
  const fn = (input: unknown) => {
    fn.calls.push(input);
  };
  fn.calls = [] as unknown[];
  return fn;
}
