import { describe, expect, it, vi } from "vitest";
import {
  fetchTaskExternalRef,
  getTaskDetail,
  listOperatorTasks,
  transitionTaskState,
} from "../src/tasks";
import type { DatabaseClient } from "../src/client";

function makeTaskQueueRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-19T09:00:00.000Z");

  return {
    id: "task-1",
    external_task_id: "issue-1",
    identifier: "TOK-1",
    title: "Build feature",
    state: "Development",
    priority: null,
    labels: [],
    assignee: null,
    url: null,
    project_slug: "token",
    project_name: "Token",
    repository_slug: null,
    latest_run_id: null,
    latest_run_status: null,
    latest_run_role: null,
    latest_run_attempt: null,
    latest_run_lease_owner: null,
    latest_run_lease_expires_at: null,
    latest_run_heartbeat_at: null,
    latest_run_started_at: null,
    latest_run_finished_at: null,
    latest_run_result_summary: null,
    latest_run_failure_reason: null,
    latest_run_retryable: null,
    latest_run_retry_after_at: null,
    latest_run_next_state: null,
    latest_run_created_at: null,
    latest_run_updated_at: null,
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
    ...overrides,
  };
}

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

  it("returns undefined when the task is absent and omits empty optional fields", async () => {
    const missingClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(fetchTaskExternalRef(missingClient, "missing")).resolves.toBeUndefined();

    const noUrlClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "task-2",
            external_task_id: "issue-2",
            identifier: "TOKEN-2",
            state: "Development",
            url: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(fetchTaskExternalRef(noUrlClient, "task-2")).resolves.toEqual({
      taskId: "task-2",
      externalTaskId: "issue-2",
      identifier: "TOKEN-2",
      state: "Development",
    });
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

  it("maps active runs and clamps invalid limits to the default", async () => {
    const now = new Date("2026-06-19T09:00:00.000Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          makeTaskQueueRow({
            labels: null,
            active_run_id: "run-active",
            active_run_status: "running",
            active_run_role: "development",
            active_run_attempt: 1,
            active_run_lease_owner: "worker-1",
            active_run_created_at: now,
            active_run_updated_at: now,
          }),
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(listOperatorTasks(client, { mode: "agent", limit: Number.NaN })).resolves.toEqual([
      {
        taskId: "task-1",
        externalTaskId: "issue-1",
        identifier: "TOK-1",
        title: "Build feature",
        state: "Development",
        mode: "agent",
        role: "development",
        labels: [],
        projectSlug: "token",
        projectName: "Token",
        activeRun: {
          runId: "run-active",
          status: "running",
          role: "development",
          attempt: 1,
          leaseOwner: "worker-1",
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    expect(vi.mocked(client.query)).toHaveBeenCalledWith(expect.any(String), [
      null,
      expect.arrayContaining(["Development", "Code Review"]),
      null,
      null,
      50,
      300_000,
      null,
      null,
    ]);
  });

  it("rejects queue rows with unknown workflow states", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [makeTaskQueueRow({ state: "Custom" })],
      }),
    } as unknown as DatabaseClient;

    await expect(listOperatorTasks(client)).rejects.toThrow("Unknown workflow state");
  });
});

describe("getTaskDetail", () => {
  it("returns undefined when the task is not found", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(getTaskDetail(client, "missing")).resolves.toBeUndefined();
  });

  it("combines queue record, runs, unresolved feedback, and progress", async () => {
    const now = new Date("2026-06-19T09:00:00.000Z");
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            makeTaskQueueRow({
              state: "Code Review",
              repository_slug: "crs-src",
              labels: [{ name: "repo:crs-src" }, { name: 123 }],
            }),
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "run-1",
              status: "failed",
              role_key: "code_review",
              attempt: 2,
              lease_owner: "worker-1",
              lease_expires_at: now,
              heartbeat_at: now,
              started_at: now,
              finished_at: now,
              result_summary: "needs fixes",
              failure_reason: "lint failed",
              retryable: false,
              retry_after_at: null,
              next_state: "Development",
              created_at: now,
              updated_at: now,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "feedback-1",
              source: "human",
              severity: "info",
              body: "Please revise",
              external_url: "http://plane/comment-1",
              created_at: now,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "progress-1",
              source: "agent_progress",
              severity: "info",
              body: "Running tests",
              external_url: null,
              created_at: now,
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(getTaskDetail(client, "task-1")).resolves.toMatchObject({
      taskId: "task-1",
      state: "Code Review",
      repositorySlug: "crs-src",
      labels: ["repo:crs-src"],
      allowedNextStates: expect.arrayContaining(["Human Review", "Development"]),
      runs: [
        {
          runId: "run-1",
          status: "failed",
          role: "code_review",
          attempt: 2,
          leaseOwner: "worker-1",
          leaseExpiresAt: now,
          heartbeatAt: now,
          startedAt: now,
          finishedAt: now,
          resultSummary: "needs fixes",
          failureReason: "lint failed",
          retryable: false,
          nextState: "Development",
          createdAt: now,
          updatedAt: now,
        },
      ],
      unresolvedFeedback: [
        {
          id: "feedback-1",
          source: "human",
          severity: "info",
          body: "Please revise",
          externalUrl: "http://plane/comment-1",
          createdAt: now,
        },
      ],
      progressItems: [
        {
          id: "progress-1",
          source: "agent_progress",
          severity: "info",
          body: "Running tests",
          createdAt: now,
        },
      ],
    });
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

  it("rejects invalid targets, missing tasks, and invalid stored task states", async () => {
    const unusedClient = { query: vi.fn() } as unknown as DatabaseClient;

    await expect(
      transitionTaskState(unusedClient, {
        taskId: "task-1",
        targetState: "Custom" as never,
      }),
    ).resolves.toEqual({
      updated: false,
      taskId: "task-1",
      reason: "target_invalid",
    });
    expect(vi.mocked(unusedClient.query)).not.toHaveBeenCalled();

    const missingClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      transitionTaskState(missingClient, {
        taskId: "missing",
        targetState: "Development",
      }),
    ).resolves.toEqual({
      updated: false,
      reason: "task_not_found",
    });

    const invalidStateClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "task-1", state: "Custom" }] }),
    } as unknown as DatabaseClient;

    await expect(
      transitionTaskState(invalidStateClient, {
        taskId: "task-1",
        targetState: "Development",
      }),
    ).resolves.toEqual({
      updated: false,
      taskId: "task-1",
      reason: "invalid_state",
    });
  });

  it("rejects transition update rows with invalid workflow states", async () => {
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
              next_state: "Custom",
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
      reason: "invalid_state",
    });
  });
});
