import { describe, expect, it, vi } from "vitest";
import { fetchTaskExternalRef, listOperatorTasks, transitionTaskState } from "../src/tasks";
import type { DatabaseClient } from "../src/client";

describe("fetchTaskExternalRef", () => {
  it("returns the Plane external task id and workflow state", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "task-1",
            external_task_id: "issue-1",
            identifier: "TOKEN-1",
            state: "Code Review",
            url: "http://plane/workspace/aiworkspace/projects/project-1/issues/issue-1",
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(fetchTaskExternalRef(client, "task-1")).resolves.toEqual({
      taskId: "task-1",
      externalTaskId: "issue-1",
      identifier: "TOKEN-1",
      state: "Code Review",
      url: "http://plane/workspace/aiworkspace/projects/project-1/issues/issue-1",
    });
  });

  it("rejects unknown workflow states", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "task-1",
            external_task_id: "issue-1",
            identifier: "TOKEN-1",
            state: "Custom",
            url: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(fetchTaskExternalRef(client, "task-1")).rejects.toThrow("Unknown workflow state");
  });
});

describe("listOperatorTasks", () => {
  it("maps queue records with run summaries", async () => {
    const now = new Date("2026-06-19T09:00:00.000Z");
    const leaseExpiresAt = new Date("2026-06-19T09:15:00.000Z");
    const retryAfterAt = new Date("2026-06-19T09:10:00.000Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "task-1",
            external_task_id: "issue-1",
            identifier: "TOK-1",
            title: "Review gate",
            state: "Human Review",
            priority: 2,
            labels: ["repo:crs-src", { name: "Feature" }],
            assignee: "operator",
            url: "http://plane/task-1",
            project_slug: "token",
            project_name: "Token",
            repository_slug: "crs-src",
            latest_run_id: "run-1",
            latest_run_status: "succeeded",
            latest_run_role: "code_review",
            latest_run_attempt: 2,
            latest_run_lease_owner: "worker-1",
            latest_run_lease_expires_at: leaseExpiresAt,
            latest_run_heartbeat_at: now,
            latest_run_started_at: now,
            latest_run_finished_at: now,
            latest_run_result_summary: "ready for human",
            latest_run_failure_reason: null,
            latest_run_retryable: true,
            latest_run_retry_after_at: retryAfterAt,
            latest_run_next_state: "Human Review",
            latest_run_created_at: now,
            latest_run_updated_at: now,
            active_run_id: null,
            active_run_status: null,
            active_run_role: null,
            active_run_attempt: null,
            active_run_lease_owner: null,
            active_run_lease_expires_at: null,
            active_run_heartbeat_at: null,
            active_run_started_at: null,
            active_run_finished_at: null,
            active_run_result_summary: null,
            active_run_failure_reason: null,
            active_run_retryable: null,
            active_run_retry_after_at: null,
            active_run_next_state: null,
            active_run_created_at: null,
            active_run_updated_at: null,
            created_at: now,
            updated_at: now,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(listOperatorTasks(client, { mode: "human" })).resolves.toEqual([
      {
        taskId: "task-1",
        externalTaskId: "issue-1",
        identifier: "TOK-1",
        title: "Review gate",
        state: "Human Review",
        mode: "human",
        role: "human_gate",
        priority: 2,
        labels: ["repo:crs-src", "Feature"],
        assignee: "operator",
        url: "http://plane/task-1",
        projectSlug: "token",
        projectName: "Token",
        repositorySlug: "crs-src",
        latestRun: {
          runId: "run-1",
          status: "succeeded",
          role: "code_review",
          attempt: 2,
          leaseOwner: "worker-1",
          leaseExpiresAt,
          heartbeatAt: now,
          startedAt: now,
          finishedAt: now,
          resultSummary: "ready for human",
          retryable: true,
          retryAfterAt,
          nextState: "Human Review",
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("passes lease and retry deep filters to the queue query", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [],
      }),
    } as unknown as DatabaseClient;

    await expect(
      listOperatorTasks(client, {
        lease: "expired",
        retry: "waiting",
        projectSlug: "token",
        repositorySlug: "crs-src",
        retryBackoffMs: 60_000,
      }),
    ).resolves.toEqual([]);

    expect(vi.mocked(client.query)).toHaveBeenCalledWith(
      expect.stringContaining("$7 = 'expired'"),
      [null, null, "token", "crs-src", 50, 60_000, "expired", "waiting"],
    );
    expect(vi.mocked(client.query)).toHaveBeenCalledWith(
      expect.stringContaining("tasks.state::text = $1"),
      expect.any(Array),
    );
    expect(vi.mocked(client.query)).toHaveBeenCalledWith(
      expect.stringContaining("tasks.state::text = any($2::text[])"),
      expect.any(Array),
    );
    expect(vi.mocked(client.query)).toHaveBeenCalledWith(
      expect.stringContaining("latest_run.status::text in ('queued', 'claimed', 'running')"),
      expect.any(Array),
    );
  });
});

describe("transitionTaskState", () => {
  it("updates tasks through allowed transitions and writes audit context", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "task-1",
              state: "Human Review",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "task-1",
              previous_state: "Human Review",
              next_state: "In Merge",
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(
      transitionTaskState(client, {
        taskId: "task-1",
        targetState: "In Merge",
        actor: "operator-ui",
        reason: "approved",
      }),
    ).resolves.toEqual({
      updated: true,
      taskId: "task-1",
      previousState: "Human Review",
      nextState: "In Merge",
    });

    expect(vi.mocked(client.query)).toHaveBeenLastCalledWith(
      expect.stringContaining("audit_events"),
      ["task-1", "In Merge", "operator-ui", "approved"],
    );
  });

  it("rejects disallowed transitions", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "task-1",
            state: "Todo",
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      transitionTaskState(client, {
        taskId: "task-1",
        targetState: "In Merge",
      }),
    ).resolves.toEqual({
      updated: false,
      taskId: "task-1",
      previousState: "Todo",
      reason: "transition_not_allowed",
    });
  });
});
