import { describe, expect, it } from "vitest";

import { getPromptReleases, getRuns, getSystemHealth, getTaskQueue } from "./control-plane-service";

describe("control plane mock service", () => {
  it("keeps every dispatchable Plane task tied to an explicit repo", async () => {
    const taskQueue = await getTaskQueue();

    expect(taskQueue.count).toBe(taskQueue.tasks.length);
    expect(taskQueue.tasks.every((task) => task.repo.length > 0)).toBe(true);
    expect(taskQueue.tasks.some((task) => task.labels.includes(`repo:${task.repo}`))).toBe(true);
  });

  it("exposes OpenHands and Langfuse links for every run", async () => {
    const runs = await getRuns();

    expect(runs.count).toBe(runs.runs.length);
    expect(runs.runs).not.toHaveLength(0);
    for (const run of runs.runs) {
      expect(run.openHandsUrl).toContain("/conversations/");
      expect(run.langfuseUrl).toContain("/traces/");
    }
  });

  it("summarizes queue state from the static fixtures", async () => {
    const taskQueue = await getTaskQueue();
    const runs = await getRuns();
    const health = await getSystemHealth();

    expect(taskQueue.summary.eligible).toBe(taskQueue.tasks.filter((task) => task.eligible).length);
    expect(taskQueue.summary.failed).toBe(
      runs.runs.filter((run) => run.status === "failed").length,
    );
    expect(health.status).toBe("degraded");
    expect(health.signals.some((signal) => signal.state === "degraded")).toBe(true);
  });

  it("exposes prompt release payloads with immutable run binding fields", async () => {
    const releases = await getPromptReleases();

    expect(releases.count).toBe(releases.promptReleases.length);
    expect(releases.promptReleases).not.toHaveLength(0);
    expect(releases.promptReleases.every((release) => release.id.startsWith("prm-"))).toBe(true);
    expect(releases.promptReleases.every((release) => release.hash.startsWith("sha256:"))).toBe(
      true,
    );
  });
});
