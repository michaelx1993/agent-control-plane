import { describe, expect, it, vi } from "vitest";
import {
  blockTasksForDispatchPolicy,
  insertPlaneCommentFeedback,
  recordTaskFeedback,
  recordTaskProgress,
  requestTaskRework,
} from "../src/feedback";
import type { DatabaseClient } from "../src/client";

describe("insertPlaneCommentFeedback", () => {
  it("inserts Plane comment feedback for mirrored tasks", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "task-1" }] })
      .mockResolvedValueOnce({ rows: [{ task_id: "task-1" }] });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      insertPlaneCommentFeedback(client, {
        externalTaskId: "issue-1",
        body: "需要返工",
      }),
    ).resolves.toEqual({ inserted: true, taskId: "task-1" });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into feedback_items"), [
      "task-1",
      "需要返工",
      null,
    ]);
  });

  it("skips duplicate Plane comment feedback", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "task-1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      insertPlaneCommentFeedback(client, {
        externalTaskId: "issue-1",
        body: "重复评论",
        externalUrl: "https://plane.test/comment-1",
      }),
    ).resolves.toEqual({
      inserted: false,
      taskId: "task-1",
      reason: "duplicate",
    });
  });

  it("skips feedback when the Plane issue has not been synced yet", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      insertPlaneCommentFeedback(client, {
        externalTaskId: "missing",
        body: "需要返工",
      }),
    ).resolves.toEqual({ inserted: false, reason: "task_not_found" });
  });
});

describe("blockTasksForDispatchPolicy", () => {
  it("moves over-budget tasks to Blocked and records agent progress", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ task_id: "task-1" }, { task_id: "task-2" }],
    });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      blockTasksForDispatchPolicy(client, [
        {
          taskId: "task-1",
          identifier: "TOK-1",
          estimatedCostUsd: 3.5,
          maxEstimatedCostUsdPerRun: 2,
        },
        {
          taskId: "task-2",
          identifier: "TOK-2",
          estimatedCostUsd: null,
          maxEstimatedCostUsdPerRun: 1,
        },
      ]),
    ).resolves.toEqual({
      blocked: 2,
      taskIds: ["task-1", "task-2"],
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("set state = 'Blocked'"), [
      JSON.stringify([
        {
          taskId: "task-1",
          identifier: "TOK-1",
          estimatedCostUsd: 3.5,
          maxEstimatedCostUsdPerRun: 2,
        },
        {
          taskId: "task-2",
          identifier: "TOK-2",
          estimatedCostUsd: null,
          maxEstimatedCostUsdPerRun: 1,
        },
      ]),
    ]);
    expect(String(query.mock.calls[0]?.[0])).toContain("'agent_progress'");
    expect(String(query.mock.calls[0]?.[0])).toContain("Agent Status: Blocked.");
  });

  it("does not query the database when there are no over-budget tasks", async () => {
    const query = vi.fn();
    const client = { query } as unknown as DatabaseClient;

    await expect(blockTasksForDispatchPolicy(client, [])).resolves.toEqual({
      blocked: 0,
      taskIds: [],
    });

    expect(query).not.toHaveBeenCalled();
  });
});

describe("requestTaskRework", () => {
  it("records actionable feedback and moves review work back to Development", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "task-1", state: "Human Review" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: "task-1",
            previous_state: "Human Review",
            feedback_id: "feedback-1",
          },
        ],
      });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      requestTaskRework(client, {
        taskId: "task-1",
        runId: "00000000-0000-0000-0000-000000000001",
        body: "修复移动端落子错位",
        source: "human",
        severity: "major",
      }),
    ).resolves.toEqual({
      updated: true,
      taskId: "task-1",
      previousState: "Human Review",
      nextState: "Development",
      feedbackId: "feedback-1",
    });

    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("state = 'Development'"), [
      "task-1",
      "00000000-0000-0000-0000-000000000001",
      "human",
      "major",
      "修复移动端落子错位",
      null,
    ]);
  });

  it("rejects states that cannot transition to Development", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: "task-1", state: "Backlog" }] }),
    } as unknown as DatabaseClient;

    await expect(
      requestTaskRework(client, {
        taskId: "task-1",
        body: "不能从 Backlog 打回",
        source: "human",
      }),
    ).resolves.toEqual({
      updated: false,
      taskId: "task-1",
      previousState: "Backlog",
      reason: "transition_not_allowed",
    });
  });
});

describe("recordTaskProgress", () => {
  it("records agent progress without changing task state", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          task_id: "task-1",
          progress_id: "progress-1",
        },
      ],
    });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      recordTaskProgress(client, {
        taskId: "task-1",
        runId: "00000000-0000-0000-0000-000000000001",
        body: "Agent Status: Running. Development agent claimed TOK-1.",
      }),
    ).resolves.toEqual({
      inserted: true,
      taskId: "task-1",
      progressId: "progress-1",
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("'agent_progress'"), [
      "task-1",
      "00000000-0000-0000-0000-000000000001",
      "Agent Status: Running. Development agent claimed TOK-1.",
      null,
    ]);
  });

  it("skips progress when the task does not exist", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      recordTaskProgress(client, {
        taskId: "missing",
        body: "Agent Status: Running.",
      }),
    ).resolves.toEqual({
      inserted: false,
      reason: "task_not_found",
    });
  });
});

describe("recordTaskFeedback", () => {
  it("records PR review feedback without moving task state", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          task_id: "task-1",
          feedback_id: "feedback-1",
        },
      ],
    });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      recordTaskFeedback(client, {
        taskId: "task-1",
        body: "PR review: add regression test.",
        source: "pr_review",
        severity: "major",
        externalUrl: "https://github.test/review/comment-1",
      }),
    ).resolves.toEqual({
      inserted: true,
      taskId: "task-1",
      feedbackId: "feedback-1",
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into feedback_items"), [
      "task-1",
      null,
      "pr_review",
      "major",
      "PR review: add regression test.",
      "https://github.test/review/comment-1",
    ]);
  });

  it("skips duplicate PR review feedback", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "task-1", state: "Code Review" }] });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      recordTaskFeedback(client, {
        taskId: "task-1",
        body: "Duplicate feedback",
        source: "pr_review",
        externalUrl: "https://github.test/review/comment-1",
      }),
    ).resolves.toEqual({
      inserted: false,
      taskId: "task-1",
      reason: "duplicate",
    });
  });

  it("rejects feedback for missing tasks", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as DatabaseClient;

    await expect(
      recordTaskFeedback(client, {
        taskId: "missing",
        body: "Missing task feedback",
        source: "pr_review",
      }),
    ).resolves.toEqual({
      inserted: false,
      reason: "task_not_found",
    });
  });
});
