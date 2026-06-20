import { describe, expect, it, vi } from "vitest";
import {
  getDispatchPolicy,
  loadDispatchPolicyFromEnv,
  updateDispatchPolicy,
} from "../src/dispatch-settings";
import type { DatabaseClient } from "../src/client";

describe("dispatch settings", () => {
  it("loads dispatch policy defaults from environment variables", () => {
    expect(
      loadDispatchPolicyFromEnv({
        WORKER_MAX_ESTIMATED_COST_USD_PER_RUN: "1.25",
        WORKER_QUEUE_PRIORITY_POLICY: "weighted_priority",
      }),
    ).toEqual({
      maxEstimatedCostUsdPerRun: 1.25,
      queuePriorityPolicy: "weighted_priority",
    });

    expect(loadDispatchPolicyFromEnv({ WORKER_MAX_ESTIMATED_COST_USD_PER_RUN: "-1" })).toEqual({
      queuePriorityPolicy: "priority_first",
    });
  });

  it("overrides environment defaults from app_settings", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { key: "dispatch.max_estimated_cost_usd_per_run", value: "2.5" },
          { key: "dispatch.queue_priority_policy", value: "weighted_priority" },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      getDispatchPolicy(client, {
        WORKER_MAX_ESTIMATED_COST_USD_PER_RUN: "1.25",
      }),
    ).resolves.toEqual({
      maxEstimatedCostUsdPerRun: 2.5,
      queuePriorityPolicy: "weighted_priority",
    });
  });

  it("falls back to environment defaults when app_settings is missing", async () => {
    const client = {
      query: vi.fn().mockRejectedValue({ code: "42P01" }),
    } as unknown as DatabaseClient;

    await expect(
      getDispatchPolicy(client, {
        WORKER_MAX_ESTIMATED_COST_USD_PER_RUN: "1.25",
      }),
    ).resolves.toEqual({
      maxEstimatedCostUsdPerRun: 1.25,
      queuePriorityPolicy: "priority_first",
    });
  });

  it("persists dispatch policy and writes an audit event", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      updateDispatchPolicy(client, {
        maxEstimatedCostUsdPerRun: 3.5,
        queuePriorityPolicy: "priority_aging",
        actorName: "operator",
      }),
    ).resolves.toEqual({
      maxEstimatedCostUsdPerRun: 3.5,
      queuePriorityPolicy: "priority_aging",
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into app_settings"), [
      "dispatch.max_estimated_cost_usd_per_run",
      3.5,
      "Dispatch policy: maximum estimated cost per run in USD.",
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into app_settings"), [
      "dispatch.queue_priority_policy",
      "priority_aging",
      "Dispatch policy: queue priority ordering.",
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("'dispatch_policy.update'"), [
      JSON.stringify({ queuePriorityPolicy: "priority_aging", maxEstimatedCostUsdPerRun: 3.5 }),
      "operator",
    ]);
  });

  it("clears persisted max cost when unset", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      updateDispatchPolicy(client, { queuePriorityPolicy: "oldest_first" }),
    ).resolves.toEqual({
      queuePriorityPolicy: "oldest_first",
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("delete from app_settings"), [
      "dispatch.max_estimated_cost_usd_per_run",
    ]);
  });
});
