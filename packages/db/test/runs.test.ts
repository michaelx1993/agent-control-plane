import { describe, expect, it, vi } from "vitest";
import {
  claimRuns,
  completeRun,
  failRun,
  getRunDetail,
  heartbeatRun,
  insertRunEvents,
  listOperatorRuns,
  markStalledRuns,
  verifyRunLease,
} from "../src/runs";
import type { DatabaseClient } from "../src/client";

describe("claimRuns", () => {
  it("passes concurrency limits into the claim query and chooses the least busy agent", async () => {
    const leaseExpiresAt = new Date("2026-06-19T10:05:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            identifier: "TOK-1",
            repository_id: "repo-1",
            repository_slug: "crs-src",
            repository_git_url: "git@example.com:crs-src.git",
            repository_default_branch: "main",
            repository_local_path: null,
            role_key: "development",
            status: "claimed",
            lease_owner: "worker-1",
            lease_expires_at: leaseExpiresAt,
            attempt: 1,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      claimRuns(client, [
        {
          taskId: "task-1",
          repositoryId: "repo-1",
          role: "development",
          leaseOwner: "worker-1",
          leaseExpiresAt,
          maxActiveRunsPerRepository: 1,
          maxActiveRunsPerRole: 2,
          maxActiveRunsPerAgent: 3,
        },
      ]),
    ).resolves.toHaveLength(1);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), [
      "task-1",
      "repo-1",
      expect.any(String),
      "development",
      "worker-1",
      "2026-06-19T10:05:00.000Z",
      expect.any(String),
      1,
      2,
      3,
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("and t.repository_id = $2::uuid"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("hashtext('acp-repository:' || $2::uuid::text)"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("active_repository.repository_id = t.repository_id"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("active_role.role_id = r.id"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("active_agent.agent_definition_id = ad.id"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("completed.status = 'succeeded'"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("completed.role_id = r.id"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("completed.next_state = t.state::text"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("order by active_agent_runs asc, ad.created_at asc"),
      expect.any(Array),
    );
  });
});

describe("markStalledRuns", () => {
  it("marks expired active runs as stalled and records heartbeat evidence", async () => {
    const heartbeatAt = new Date("2026-06-19T10:00:00Z");
    const finishedAt = new Date("2026-06-19T10:30:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            status: "stalled",
            heartbeat_at: heartbeatAt,
            finished_at: finishedAt,
            next_state: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      markStalledRuns(client, {
        heartbeatStaleBefore: new Date("2026-06-19T10:20:00Z"),
        leaseExpiredBefore: new Date("2026-06-19T10:30:00Z"),
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        runId: "run-1",
        taskId: "task-1",
        status: "stalled",
        heartbeatAt,
        finishedAt,
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'stalled'"), [
      "2026-06-19T10:20:00.000Z",
      "2026-06-19T10:30:00.000Z",
      10,
      expect.any(String),
    ]);
  });

  it("blocks tasks when a run fails with retryable false", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            status: "failed",
            heartbeat_at: null,
            finished_at: new Date("2026-06-19T10:30:00Z"),
            next_state: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await failRun(client, {
      runId: "run-1",
      leaseOwner: "worker-1",
      failureReason: "non retryable",
      retryable: false,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("state = 'Blocked'"), [
      "run-1",
      "worker-1",
      "non retryable",
      false,
      expect.any(String),
    ]);
  });
});

describe("terminal run idempotency", () => {
  it("returns an existing succeeded run when complete is repeated with the same result", async () => {
    const finishedAt = new Date("2026-06-19T10:30:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            status: "succeeded",
            heartbeat_at: finishedAt,
            finished_at: finishedAt,
            next_state: "Code Review",
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      completeRun(client, {
        runId: "run-1",
        leaseOwner: "worker-1",
        resultSummary: "done",
        nextState: "Code Review",
      }),
    ).resolves.toEqual({
      runId: "run-1",
      taskId: "task-1",
      status: "succeeded",
      heartbeatAt: finishedAt,
      finishedAt,
      nextState: "Code Review",
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'succeeded'"), [
      "run-1",
      "worker-1",
      "done",
      "Code Review",
      false,
      expect.any(String),
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("result_summary = $3"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("next_state is not distinct from $4"),
      expect.any(Array),
    );
  });

  it("returns an existing failed run when fail is repeated with the same reason", async () => {
    const finishedAt = new Date("2026-06-19T10:30:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            status: "failed",
            heartbeat_at: finishedAt,
            finished_at: finishedAt,
            next_state: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      failRun(client, {
        runId: "run-1",
        leaseOwner: "worker-1",
        failureReason: "tests failed",
        retryable: true,
      }),
    ).resolves.toEqual({
      runId: "run-1",
      taskId: "task-1",
      status: "failed",
      heartbeatAt: finishedAt,
      finishedAt,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), [
      "run-1",
      "worker-1",
      "tests failed",
      true,
      expect.any(String),
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("failure_reason = $3"),
      expect.any(Array),
    );
  });
});

describe("verifyRunLease", () => {
  it("returns an active lease for the current worker only", async () => {
    const leaseExpiresAt = new Date("2026-06-19T10:05:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            status: "running",
            lease_owner: "worker-1",
            lease_expires_at: leaseExpiresAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(verifyRunLease(client, "run-1", "worker-1")).resolves.toEqual({
      runId: "run-1",
      taskId: "task-1",
      status: "running",
      leaseOwner: "worker-1",
      leaseExpiresAt,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("and lease_owner = $2"), [
      "run-1",
      "worker-1",
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("status in ('claimed', 'running')"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("lease_expires_at > now()"),
      expect.any(Array),
    );
  });
});

describe("listOperatorRuns", () => {
  it("returns recent runs with task, repository, and role context", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const updatedAt = new Date("2026-06-19T10:10:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            task_identifier: "TOKEN-1",
            task_title: "Build",
            repository_slug: "crs-src",
            role_key: "development",
            status: "running",
            lease_owner: "worker-1",
            lease_expires_at: null,
            heartbeat_at: null,
            attempt: 2,
            started_at: null,
            finished_at: null,
            result_summary: null,
            failure_reason: null,
            next_state: "Code Review",
            created_at: createdAt,
            updated_at: updatedAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      listOperatorRuns(client, {
        status: "running",
        repositorySlug: "crs-src",
        role: "development",
        taskIdentifier: "TOKEN-1",
        limit: 500,
      }),
    ).resolves.toEqual([
      {
        runId: "run-1",
        taskId: "task-1",
        taskIdentifier: "TOKEN-1",
        taskTitle: "Build",
        repositorySlug: "crs-src",
        role: "development",
        status: "running",
        leaseOwner: "worker-1",
        attempt: 2,
        nextState: "Code Review",
        createdAt,
        updatedAt,
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("repositories.slug = $2"), [
      "running",
      "crs-src",
      "development",
      "TOKEN-1",
      200,
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("runs.status::text = $1"),
      expect.any(Array),
    );
  });
});

describe("insertRunEvents", () => {
  it("persists adapter event stream summaries", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "event-1",
            event_type: "openhands.tool_call",
            message: "Tool call finished.",
            payload: { tool: "shell", exitCode: 0 },
            created_at: createdAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      insertRunEvents(client, "run-1", [
        {
          eventType: "openhands.tool_call",
          message: "Tool call finished.",
          payload: { tool: "shell", exitCode: 0 },
        },
      ]),
    ).resolves.toEqual([
      {
        id: "event-1",
        eventType: "openhands.tool_call",
        message: "Tool call finished.",
        payload: { tool: "shell", exitCode: 0 },
        createdAt,
      },
    ]);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into run_events"), [
      "run-1",
      "openhands.tool_call",
      "Tool call finished.",
      { tool: "shell", exitCode: 0 },
    ]);
  });
});

describe("heartbeatRun", () => {
  it("renews the active lease when a next lease expiry is provided", async () => {
    const heartbeatAt = new Date("2026-06-19T10:00:00Z");
    const leaseExpiresAt = new Date("2026-06-19T10:15:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "run-1",
            task_id: "task-1",
            status: "running",
            heartbeat_at: heartbeatAt,
            finished_at: null,
            next_state: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(heartbeatRun(client, "run-1", "worker-1", leaseExpiresAt)).resolves.toEqual({
      runId: "run-1",
      taskId: "task-1",
      status: "running",
      heartbeatAt,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("lease_expires_at"), [
      "run-1",
      "worker-1",
      "2026-06-19T10:15:00.000Z",
      expect.any(String),
    ]);
  });
});

describe("getRunDetail", () => {
  it("returns run detail with prompt release, conversation, events, and traces", async () => {
    const createdAt = new Date("2026-06-19T10:00:00Z");
    const updatedAt = new Date("2026-06-19T10:10:00Z");
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: "run-1",
              task_id: "task-1",
              task_identifier: "TOKEN-1",
              task_title: "Build",
              repository_slug: "crs-src",
              role_key: "development",
              status: "succeeded",
              lease_owner: "worker-1",
              lease_expires_at: null,
              heartbeat_at: null,
              attempt: 1,
              started_at: null,
              finished_at: null,
              result_summary: "done",
              failure_reason: null,
              next_state: "Code Review",
              created_at: createdAt,
              updated_at: updatedAt,
              project_slug: "token",
              project_name: "Token",
              repository_id: "repo-1",
              repository_git_url: "git@example.com:repo.git",
              repository_default_branch: "main",
              repository_local_path: "/tmp/repo",
              workspace_strategy: "ephemeral",
              workspace_path: "/tmp/workspaces/crs-src/run-1",
              workspace_base_ref: "main",
              workspace_head_ref: "agent/run-1",
              workspace_status: "ready",
              workspace_created_at: createdAt,
              workspace_cleaned_at: null,
              agent_name: "Development Agent",
              agent_model: "gpt-5.5",
              prompt_release_id: "release-1",
              prompt_release_hash: "abc123",
              prompt_release_created_at: createdAt,
              plane_runtime_snapshot_id: "snapshot-1",
              plane_runtime_snapshot_hash: "snapshot-hash",
              plane_runtime_snapshot_payload: {
                schemaVersion: "plane-runtime-snapshot.v1",
                run: { id: "run-1" },
                task: { identifier: "TOKEN-1" },
                project: { slug: "token" },
                repository: { slug: "crs-src" },
                role: { key: "development" },
                agent: { name: "Development Agent" },
                worker: { workerId: "mac-studio-worker-1" },
                prompts: [
                  {
                    binding: { scope: "agent", kind: "system" },
                    prompt: { name: "Builder" },
                    version: { version: 3, body: "Build safely" },
                  },
                ],
                assembledPrompt: "Build safely",
                availableSecretKeys: ["GITHUB_TOKEN"],
              },
              plane_runtime_snapshot_created_at: createdAt,
              conversation_provider: "openhands",
              conversation_id: "conv-1",
              event_log_uri: "file:///tmp/events.jsonl",
              conversation_ui_url: null,
              conversation_updated_at: updatedAt,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "event-1",
              event_type: "completed",
              message: "done",
              payload: { ok: true },
              created_at: updatedAt,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "trace-1",
              provider: "langfuse",
              trace_id: "trace",
              generation_id: null,
              model: "gpt-5.5",
              prompt_release_id: "release-1",
              input_tokens: "10",
              output_tokens: "20",
              cost_usd: "0.01",
              latency_ms: 100,
              ui_url: null,
              created_at: updatedAt,
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(getRunDetail(client, "run-1")).resolves.toMatchObject({
      runId: "run-1",
      taskIdentifier: "TOKEN-1",
      projectSlug: "token",
      repositoryGitUrl: "git@example.com:repo.git",
      workspace: {
        strategy: "ephemeral",
        path: "/tmp/workspaces/crs-src/run-1",
        baseRef: "main",
        headRef: "agent/run-1",
        status: "ready",
        createdAt,
      },
      agentName: "Development Agent",
      promptRelease: {
        id: "release-1",
        contentHash: "abc123",
      },
      planeRuntimeSnapshot: {
        id: "snapshot-1",
        snapshotHash: "snapshot-hash",
        payload: {
          assembledPrompt: "Build safely",
          availableSecretKeys: ["GITHUB_TOKEN"],
        },
      },
      conversation: {
        provider: "openhands",
        conversationId: "conv-1",
      },
      events: [
        {
          eventType: "completed",
          message: "done",
        },
      ],
      traces: [
        {
          provider: "langfuse",
          traceId: "trace",
          inputTokens: 10,
          outputTokens: 20,
        },
      ],
    });
  });
});
