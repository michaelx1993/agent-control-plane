import { describe, expect, it, vi } from "vitest";
import {
  DbControlPlaneStore,
  DispatchWorker,
  InMemoryControlPlaneStore,
  MockOpenHandsAdapter,
  MockTraceRecorder,
  PlaneTaskSyncService,
  createMockTask,
  loadConfig,
  normalizedPlaneTaskToDbInput,
  planeStateNameToDbTaskState,
} from "../src/index.js";
import type { DbClient } from "@agent-control-plane/db";
import type { PlaneClient, PlaneTaskPayload } from "@agent-control-plane/plane";

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

  it("maps Plane state and repo labels into DB task input", () => {
    expect(planeStateNameToDbTaskState("Code Review")).toBe("CodeReview");
    expect(planeStateNameToDbTaskState("In Merge")).toBe("InMerge");
    expect(planeStateNameToDbTaskState("release-version")).toBe("ReleaseVersion");
    expect(planeStateNameToDbTaskState("unknown custom state")).toBe("Todo");

    expect(
      normalizedPlaneTaskToDbInput(
        {
          source: "plane",
          sourceId: "plane-1",
          identifier: "TOK-1",
          title: "Implement sync",
          stateName: "Development",
          repo: "crs-src",
          labels: ["repo:crs-src", "Feature"],
          url: "https://plane.test/TOK-1",
          isDispatchable: true,
          raw: { id: "plane-1" },
        },
        "token",
      ),
    ).toEqual({
      projectSlug: "token",
      externalTaskId: "plane-1",
      identifier: "TOK-1",
      title: "Implement sync",
      state: "Development",
      repositorySlug: "crs-src",
      labels: ["repo:crs-src", "Feature"],
      url: "https://plane.test/TOK-1",
    });
  });

  it("syncs Plane work items into the DB upsert path", async () => {
    const payloads: PlaneTaskPayload[] = [
      {
        id: "plane-1",
        identifier: "TOK-1",
        name: "Implement Plane sync",
        state: { name: "Development" },
        labels: [{ name: "repo:crs-src" }],
      },
      {
        id: "plane-2",
        identifier: "TOK-2",
        name: "Needs repo label",
        state: { name: "Todo" },
        labels: [{ name: "Feature" }],
      },
    ];
    const listTasks = vi.fn().mockResolvedValue(payloads);
    const plane = {
      listTasks,
    } as unknown as PlaneClient;
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      $transaction: vi.fn(async (callback) => {
        return callback({
          project: {
            findFirst: vi.fn().mockResolvedValue({ id: "project-1" }),
          },
          repository: {
            findFirst: vi.fn().mockResolvedValue({ id: "repo-1" }),
          },
          task: {
            upsert,
          },
        });
      }),
    } as unknown as DbClient;
    const sync = new PlaneTaskSyncService(db, plane, {
      projectSlug: "token",
      workspaceSlug: "acme",
      projectId: "project-plane-1",
      perPage: 10,
    });

    const result = await sync.sync();

    expect(listTasks).toHaveBeenCalledWith({
      workspaceSlug: "acme",
      projectId: "project-plane-1",
      perPage: 10,
    });
    expect(result).toEqual({ fetched: 2, upserted: 2, blockedMissingRepo: 1 });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          repositoryId: "repo-1",
          title: "Implement Plane sync",
          state: "Development",
        }),
      }),
    );
  });

  it("writes completed run state and summary back to Plane", async () => {
    const updateTask = vi.fn().mockResolvedValue({ id: "plane-1" });
    const addComment = vi.fn().mockResolvedValue({ id: "comment-1", body: "ok" });
    const plane = {
      updateTask,
      addComment,
    } as unknown as PlaneClient;
    const sync = new PlaneTaskSyncService({} as DbClient, plane, {
      projectSlug: "token",
    });

    await sync.syncRunResult(
      createMockTask({ planeId: "plane-1", state: "Development" }),
      {
        status: "succeeded",
        conversationId: "conv-1",
        summary: "Implemented feature and tests passed.",
      },
      { traceId: "trace-1", url: "https://langfuse.test/trace-1" },
      "Code Review",
    );

    expect(updateTask).toHaveBeenCalledWith("plane-1", {
      stateName: "Code Review",
      summary: "Implemented feature and tests passed.",
    });
    expect(addComment).toHaveBeenCalledWith(
      "plane-1",
      expect.stringContaining("Agent Status: Completed"),
    );
    expect(addComment).toHaveBeenCalledWith(
      "plane-1",
      expect.stringContaining("Trace: https://langfuse.test/trace-1"),
    );
  });
});
