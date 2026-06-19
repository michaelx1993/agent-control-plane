import { describe, expect, it } from "vitest";

import { healthSignals, queueSummary, runs, taskQueue } from "./mock-data";

describe("admin console mock data", () => {
  it("keeps every dispatchable Plane task tied to an explicit repo", () => {
    expect(taskQueue.every((task) => task.repo.length > 0)).toBe(true);
    expect(taskQueue.some((task) => task.labels.includes(`repo:${task.repo}`))).toBe(true);
  });

  it("exposes OpenHands and Langfuse links for every run", () => {
    expect(runs).not.toHaveLength(0);
    for (const run of runs) {
      expect(run.openHandsUrl).toContain("/conversations/");
      expect(run.langfuseUrl).toContain("/traces/");
    }
  });

  it("summarizes queue state from the static fixtures", () => {
    expect(queueSummary.eligible).toBe(taskQueue.filter((task) => task.eligible).length);
    expect(queueSummary.failed).toBe(runs.filter((run) => run.status === "failed").length);
    expect(healthSignals.some((signal) => signal.state === "degraded")).toBe(true);
  });
});
