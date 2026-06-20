import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  claimRuns: vi.fn(),
  createPromptReleaseForRun: vi.fn(),
  fetchDispatchInputSnapshot: vi.fn(),
  findLatestConversationRefForTask: vi.fn(),
  getDispatchPolicy: vi.fn(),
  markStalledRuns: vi.fn(),
  withDatabasePool: vi.fn(async (callback: (pool: unknown) => Promise<unknown>) =>
    callback({ pool: true }),
  ),
  withTransaction: vi.fn(async (_pool: unknown, callback: (client: unknown) => Promise<unknown>) =>
    callback({ transaction: true }),
  ),
}));

vi.mock("@agent-control-plane/db", () => db);

describe("claimWorkerRuns", () => {
  beforeEach(() => {
    db.claimRuns.mockReset();
    db.createPromptReleaseForRun.mockReset();
    db.fetchDispatchInputSnapshot.mockReset();
    db.findLatestConversationRefForTask.mockReset();
    db.getDispatchPolicy.mockReset();
    db.markStalledRuns.mockReset();
    db.withDatabasePool.mockClear();
    db.withTransaction.mockClear();

    db.getDispatchPolicy.mockResolvedValue({});
    db.markStalledRuns.mockResolvedValue([]);
    db.createPromptReleaseForRun.mockResolvedValue({
      id: "prompt-release-1",
      contentHash: "hash",
      renderedContent: "rendered prompt",
    });
    db.findLatestConversationRefForTask.mockResolvedValue(undefined);
  });

  it("continues scanning after skipped tasks when maxRuns is smaller than the queue", async () => {
    const { claimWorkerRuns } = await import("../src/worker-claim");
    db.fetchDispatchInputSnapshot.mockResolvedValue({
      tasks: [
        {
          id: "task-unrouted",
          identifier: "TOKEN-1",
          title: "Unrouted task",
          state: "Development",
          labels: [],
        },
        {
          id: "task-routed",
          identifier: "TOKEN-2",
          title: "Routed task",
          state: "Development",
          repositoryId: "repo-1",
          labels: ["repo:crs-src"],
        },
      ],
      repositories: [{ id: "repo-1", slug: "crs-src", status: "active" }],
      activeRuns: [],
    });
    db.claimRuns.mockImplementation(async (_client: unknown, claims: Array<{ taskId: string }>) =>
      claims.map((claim) => ({
        runId: "run-1",
        taskId: claim.taskId,
        identifier: "TOKEN-2",
        repositoryId: "repo-1",
        repositorySlug: "crs-src",
        repositoryGitUrl: "git@example.com:michaelx1993/crs-src.git",
        repositoryDefaultBranch: "main",
        role: "development",
        status: "claimed",
        leaseOwner: "worker-1",
        leaseExpiresAt: new Date("2026-06-20T12:00:00Z"),
        attempt: 1,
      })),
    );

    const result = await claimWorkerRuns({
      workerId: "worker-1",
      maxRuns: 1,
      leaseTtlMs: 60_000,
    });

    expect(db.claimRuns).toHaveBeenCalledWith(expect.any(Object), [
      expect.objectContaining({
        taskId: "task-routed",
        identifier: "TOKEN-2",
        repositoryId: "repo-1",
      }),
    ]);
    expect(result.claimed).toHaveLength(1);
    expect(result.claimed[0]?.run.identifier).toBe("TOKEN-2");
    expect(result.skipped).toEqual([
      {
        taskId: "task-unrouted",
        identifier: "TOKEN-1",
        reasons: ["task has no resolvable repository"],
      },
    ]);
  });
});
