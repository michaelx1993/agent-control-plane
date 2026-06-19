import { describe, expect, it, vi } from "vitest";
import {
  DbControlPlaneStore,
  DispatchWorker,
  InMemoryControlPlaneStore,
  MockOpenHandsAdapter,
  MockTraceRecorder,
  createMockTask,
  loadConfig,
} from "../src/index.js";
import type { DbClient } from "@agent-control-plane/db";

describe("DispatchWorker", () => {
  it("moves a successful development run from queued/running to succeeded and suggests Code Review", async () => {
    const task = createMockTask({ state: "Development" });
    const store = new InMemoryControlPlaneStore([task]);
    const worker = new DispatchWorker(
      loadConfig({ WORKER_MODE: "mock", WORKER_ENABLED_TEAMS: "token-team" }),
      store,
      new MockOpenHandsAdapter(),
      new MockTraceRecorder(),
    );

    const before = await store.findDispatchableTasks(
      loadConfig({ WORKER_ENABLED_TEAMS: "token-team" }),
    );
    expect(before).toHaveLength(1);

    const result = await worker.dispatchOnce();

    expect(result).toBeDefined();
    expect(result?.run.status).toBe("succeeded");
    expect(result?.run.nextState).toBe("Code Review");
    expect(result?.run.conversationId).toMatch(/^oh-run-/);
    expect(result?.run.langfuseTraceId).toMatch(/^lf-run-/);
    expect(result?.task.state).toBe("Code Review");

    const runs = [...store.runs.values()];
    expect(runs.map((run) => run.status)).toEqual(["succeeded"]);
    expect(runs[0].statusHistory).toEqual(["queued", "claimed", "running", "succeeded"]);
    expect(runs[0].promptSnapshot).toContain("Role: Development Agent");
  });

  it("keeps WORKER_MODE=mock on the in-memory path", () => {
    expect(loadConfig({ WORKER_MODE: "mock" }).mode).toBe("mock");
    expect(loadConfig({ WORKER_MODE: "live" }).mode).toBe("live");
    expect(loadConfig({}).mode).toBe("mock");
  });

  it("maps DB-backed dispatchable tasks without connecting to a real database", async () => {
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: "task-db-1",
        externalTaskId: "plane-db-1",
        title: "Wire live worker store",
        url: "https://plane.test/token/ACP-1",
        state: "Development",
        labels: ["repo:crs-src", "kind:worker"],
        repositoryId: "repo-1",
        repository: {
          slug: "crs-src",
          status: "active",
        },
        project: {
          slug: "token",
          team: {
            name: "token-team",
            key: "TOK",
            externalTeamId: "token-team",
          },
        },
      },
    ]);
    const db = {
      task: {
        findMany: taskFindMany,
      },
    } as unknown as DbClient;
    const store = new DbControlPlaneStore(db);

    const tasks = await store.findDispatchableTasks(
      loadConfig({ WORKER_MODE: "live", WORKER_ENABLED_TEAMS: "token-team" }),
    );

    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          project: {
            include: {
              team: true,
            },
          },
          repository: true,
        }),
      }),
    );
    expect(tasks).toEqual([
      expect.objectContaining({
        id: "task-db-1",
        planeId: "plane-db-1",
        team: "token-team",
        project: "token",
        repo: "crs-src",
        state: "Development",
        labels: ["repo:crs-src", "kind:worker"],
      }),
    ]);
  });
});
