import { describe, expect, it, vi } from "vitest";
import { fetchActiveRunSnapshots, fetchTaskSnapshots } from "../src/snapshots";
import type { DatabaseClient } from "../src/client";

describe("fetchTaskSnapshots", () => {
  it("passes retry backoff into the dispatch query", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "task-1",
            identifier: "TOKEN-1",
            title: "Build",
            state: "Development",
            repository_id: "repo-1",
            labels: ["repo:crs-src"],
            priority: 1,
            estimated_cost_usd: "1.250000",
            updated_at: new Date("2026-06-19T10:00:00Z"),
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(fetchTaskSnapshots(client, { retryBackoffMs: 120000 })).resolves.toEqual([
      {
        id: "task-1",
        identifier: "TOKEN-1",
        title: "Build",
        state: "Development",
        repositoryId: "repo-1",
        labels: ["repo:crs-src"],
        priority: 1,
        estimatedCostUsd: 1.25,
        updatedAt: new Date("2026-06-19T10:00:00Z"),
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "state::text in ('Todo', 'Development', 'Code Review', 'In Merge', 'Release Version', 'Deployment')",
      ),
      [120000],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("recent.status::text in"),
      [120000],
    );
  });

  it("can order dispatch tasks by queue priority policy", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await fetchTaskSnapshots(client, {
      retryBackoffMs: 0,
      queuePriorityPolicy: "newest_first",
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("order by updated_at desc"),
      [0],
    );
  });

  it("can order dispatch tasks with priority aging", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await fetchTaskSnapshots(client, {
      retryBackoffMs: 0,
      queuePriorityPolicy: "priority_aging",
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("coalesce(priority, 1000000)"),
      [0],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "floor(greatest(extract(epoch from (now() - updated_at)), 0) / 86400.0)",
      ),
      [0],
    );
  });

  it("can order dispatch tasks fairly across repositories", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await fetchTaskSnapshots(client, {
      retryBackoffMs: 0,
      queuePriorityPolicy: "repo_fair",
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("partition by repository_id"),
      [0],
    );
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("row_number() over"), [0]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("repository_id asc nulls last"),
      [0],
    );
  });

  it("can order dispatch tasks by weighted priority", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await fetchTaskSnapshots(client, {
      retryBackoffMs: 0,
      queuePriorityPolicy: "weighted_priority",
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("(coalesce(priority, 1000000) + coalesce(estimated_cost_usd, 0))"),
      [0],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("estimated_cost_usd asc nulls first"),
      [0],
    );
  });
});

describe("fetchActiveRunSnapshots", () => {
  it("returns repository and role context for concurrency policy", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            task_id: "task-1",
            repository_id: "repo-1",
            role_key: "development",
            status: "running",
            lease_expires_at: new Date("2026-06-19T10:05:00Z"),
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(fetchActiveRunSnapshots(client)).resolves.toEqual([
      {
        taskId: "task-1",
        repositoryId: "repo-1",
        role: "development",
        status: "running",
        leaseExpiresAt: new Date("2026-06-19T10:05:00Z"),
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("join roles"));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("where runs.status in"));
  });
});
