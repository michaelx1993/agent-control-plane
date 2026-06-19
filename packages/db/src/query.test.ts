import { describe, expect, it } from "vitest";

import { isDispatchableTaskCandidate, markExpiredLeasesFailed } from "./query.js";
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
});
