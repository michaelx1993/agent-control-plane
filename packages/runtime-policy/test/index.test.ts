import { describe, expect, it } from "vitest";
import { evaluateRuntimePolicy, sortRuntimeQueue, type TaskCandidate } from "../src/index.js";

const task = (overrides: Partial<TaskCandidate> = {}): TaskCandidate => ({
  id: overrides.id ?? "task-1",
  repo: overrides.repo ?? "repo-a",
  role: overrides.role ?? "engineer",
  priority: overrides.priority,
  estimatedCost: overrides.estimatedCost,
  createdAt: overrides.createdAt,
});

describe("runtime policy", () => {
  it("blocks dispatch when repo concurrency is already at its limit", () => {
    const result = evaluateRuntimePolicy(
      [task({ id: "task-2", repo: "repo-a" })],
      [{ taskId: "task-1", repo: "repo-a", role: "engineer" }],
      { repoConcurrency: { "repo-a": 1 } },
    );

    expect(result.dispatch).toEqual([
      {
        task: task({ id: "task-2", repo: "repo-a" }),
        status: "blocked",
        reason: "repo-concurrency-exceeded",
      },
    ]);
  });

  it("queues dispatch when role concurrency is already at its limit", () => {
    const candidate = task({ id: "task-2", repo: "repo-b", role: "reviewer" });

    const result = evaluateRuntimePolicy(
      [candidate],
      [{ taskId: "task-1", repo: "repo-a", role: "reviewer" }],
      { roleConcurrency: { reviewer: 1 }, repoConcurrency: { "repo-b": 1 } },
    );

    expect(result.dispatch).toEqual([
      { task: candidate, status: "queued", reason: "role-concurrency-exceeded" },
    ]);
  });

  it("waits for approval or blocks when projected cost exceeds budget", () => {
    const waiting = evaluateRuntimePolicy(
      [task({ id: "task-2", estimatedCost: 15 })],
      [{ taskId: "task-1", repo: "repo-b", role: "engineer", costReserved: 10 }],
      { costBudget: { limit: 20, spent: 0 } },
    );

    expect(waiting.dispatch[0]).toMatchObject({
      status: "waiting-approval",
      reason: "cost-budget-exceeded",
    });

    const blocked = evaluateRuntimePolicy([task({ id: "task-3", estimatedCost: 15 })], [], {
      costBudget: { limit: 10, onExceeded: "blocked" },
    });

    expect(blocked.dispatch[0]).toMatchObject({
      status: "blocked",
      reason: "cost-budget-exceeded",
    });
  });

  it("orders the queue by priority, then oldest createdAt, then input order", () => {
    const low = task({ id: "low", priority: 1, createdAt: "2026-06-18T09:00:00Z" });
    const highNew = task({ id: "high-new", priority: 10, createdAt: "2026-06-18T10:00:00Z" });
    const highOld = task({ id: "high-old", priority: 10, createdAt: "2026-06-18T08:00:00Z" });

    expect(sortRuntimeQueue([low, highNew, highOld]).map((entry) => entry.task.id)).toEqual([
      "high-old",
      "high-new",
      "low",
    ]);
  });

  it("does not dispatch the same task twice", () => {
    const duplicate = task({ id: "task-2" });

    const result = evaluateRuntimePolicy(
      [duplicate, duplicate, task({ id: "task-1" })],
      [{ taskId: "task-1", repo: "repo-a", role: "engineer" }],
    );

    expect(
      result.dispatch.map((decision) => [decision.task.id, decision.status, decision.reason]),
    ).toEqual([
      ["task-2", "allowed", "allowed"],
      ["task-2", "blocked", "duplicate-candidate-task"],
      ["task-1", "blocked", "duplicate-active-task"],
    ]);
  });
});
