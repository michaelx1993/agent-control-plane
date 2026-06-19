import { describe, expect, it } from "vitest";
import {
  DispatchWorker,
  InMemoryControlPlaneStore,
  MockOpenHandsAdapter,
  MockTraceRecorder,
  createMockTask,
  loadConfig,
} from "../src/index.js";

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
});
