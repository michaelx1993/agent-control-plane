import { describe, expect, it } from "vitest";

import {
  getMonitoring,
  getPromptReleases,
  getRunDetail,
  getRuns,
  getSystemHealth,
  getTaskQueue,
} from "./control-plane-service";

describe("control plane mock service", () => {
  it("keeps every dispatchable Plane task tied to an explicit repo", async () => {
    const taskQueue = await getTaskQueue();

    expect(taskQueue.count).toBe(taskQueue.tasks.length);
    expect(taskQueue.tasks.every((task) => task.repo.length > 0)).toBe(true);
    expect(taskQueue.tasks.some((task) => task.labels.includes(`repo:${task.repo}`))).toBe(true);
    expect(taskQueue.tasks.every((task) => task.maxAttempts >= task.attempt)).toBe(true);
    expect(taskQueue.tasks.some((task) => task.dispatchStatus === "retry_capped")).toBe(true);
    expect(taskQueue.tasks.some((task) => task.dispatchStatus === "budget_blocked")).toBe(true);
    expect(taskQueue.tasks.some((task) => task.dispatchStatus === "repo_concurrency")).toBe(true);
  });

  it("exposes OpenHands and Langfuse links for every run", async () => {
    const runs = await getRuns();

    expect(runs.count).toBe(runs.runs.length);
    expect(runs.runs).not.toHaveLength(0);
    for (const run of runs.runs) {
      expect(run.openHandsUrl).toContain("/conversations/");
      expect(run.langfuseUrl).toContain("/traces/");
      expect(run.attempt).toBeGreaterThanOrEqual(1);
      expect(run.maxAttempts).toBeGreaterThanOrEqual(run.attempt);
      expect(run.tokenInput + run.tokenOutput).toBeGreaterThan(0);
      expect(Number(run.costUsd)).toBeGreaterThan(0);
    }
  });

  it("exposes run detail with timeline and observability refs", async () => {
    const runs = await getRuns();
    const run = await getRunDetail(runs.runs[0].id);

    expect(run).toMatchObject({
      id: runs.runs[0].id,
      agent: expect.any(String),
      conversationId: expect.any(String),
      events: expect.any(Array),
      attempt: expect.any(Number),
      maxAttempts: expect.any(Number),
      model: "gpt-5.5 medium",
      progress: expect.any(Array),
      promptPreview: expect.any(String),
      traceId: expect.any(String),
      workpad: expect.any(String),
      workspacePath: expect.any(String),
      workspaceStatus: expect.any(String),
      workspaceStrategy: expect.any(String),
    });
    expect(run?.maxAttempts).toBeGreaterThanOrEqual(run?.attempt ?? 0);
    expect(run?.events.length).toBeGreaterThan(0);
    expect(run?.progress.length).toBeGreaterThan(0);
    expect(run?.workpad).toContain("Latest Progress");
  });

  it("summarizes queue state from the static fixtures", async () => {
    const taskQueue = await getTaskQueue();
    const runs = await getRuns();
    const health = await getSystemHealth();

    expect(taskQueue.summary.eligible).toBe(taskQueue.tasks.filter((task) => task.eligible).length);
    expect(taskQueue.summary.retryCapped).toBe(
      taskQueue.tasks.filter((task) => task.dispatchStatus === "retry_capped").length,
    );
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

  it("summarizes production monitoring indicators", async () => {
    const monitoring = await getMonitoring();

    expect(monitoring.queue.total).toBeGreaterThan(0);
    expect(monitoring.runs.total).toBeGreaterThan(0);
    expect(monitoring.usage.totalTokens).toBeGreaterThan(0);
    expect(Number(monitoring.usage.costUsd)).toBeGreaterThan(0);
    expect(monitoring.stalledRuns.some((run) => run.reason.includes("stalled"))).toBe(true);
  });
});
