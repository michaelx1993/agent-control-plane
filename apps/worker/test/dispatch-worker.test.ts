import { describe, expect, it, vi } from "vitest";
import {
  DbControlPlaneStore,
  DispatchWorker,
  InMemoryControlPlaneStore,
  LangfuseTraceRecorder,
  MockOpenHandsAdapter,
  MockTraceRecorder,
  OpenHandsRuntimeAdapter,
  PlaneTaskSyncService,
  createOpenHandsAdapter,
  createTraceRecorder,
  createMockTask,
  formatLiveDispatchResult,
  loadConfig,
  normalizedPlaneTaskToDbInput,
  planeStateNameToDbTaskState,
  redactRuntimeSecrets,
} from "../src/index.js";
import {
  parseLiveDispatchEvidence,
  validateLiveDispatchEvidence,
} from "../src/live-verification.js";
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

  it("formats live dispatch evidence for operator verification", () => {
    const task = createMockTask({
      id: "task-1",
      planeId: "plane-1",
      title: "Implement live smoke",
      state: "Code Review",
    });

    expect(
      formatLiveDispatchResult({
        task,
        prompt: "redacted prompt",
        run: {
          id: "run-1",
          taskId: task.id,
          status: "succeeded",
          role: "Development Agent",
          attempt: 2,
          promptReleaseId: "prompt-release-1",
          workspacePath: "/tmp/crs-src/runs/run-1",
          conversationId: "conversation-1",
          conversationUrl: "https://openhands.test/conversations/conversation-1",
          langfuseTraceId: "trace-1",
          langfuseTraceUrl: "https://langfuse.test/trace-1",
          summary: "Implemented and tested.",
          nextState: "Code Review",
          statusHistory: ["queued", "claimed", "running", "succeeded"],
          createdAt: new Date("2026-06-18T00:00:00.000Z"),
          updatedAt: new Date("2026-06-18T00:00:00.000Z"),
        },
      }),
    ).toEqual({
      task: {
        id: "task-1",
        planeId: "plane-1",
        title: "Implement live smoke",
        team: "token-team",
        project: "token",
        repo: "crs-src",
        state: "Code Review",
      },
      run: {
        id: "run-1",
        status: "succeeded",
        role: "Development Agent",
        attempt: 2,
        promptReleaseId: "prompt-release-1",
        workspacePath: "/tmp/crs-src/runs/run-1",
        conversationId: "conversation-1",
        conversationUrl: "https://openhands.test/conversations/conversation-1",
        langfuseTraceId: "trace-1",
        langfuseTraceUrl: "https://langfuse.test/trace-1",
        nextState: "Code Review",
        summary: "Implemented and tested.",
        error: null,
      },
      verification: {
        runDetailPath: "/runs/run-1",
        planeEvidence: "plane-1",
        openHandsEvidence: "https://openhands.test/conversations/conversation-1",
        langfuseEvidence: "https://langfuse.test/trace-1",
        expectedNextState: "Code Review",
      },
    });
  });

  it("validates live dispatch evidence before operators trust the smoke result", () => {
    const task = createMockTask({
      id: "task-1",
      planeId: "plane-1",
      title: "Implement live smoke",
      state: "Code Review",
    });
    const evidence = formatLiveDispatchResult({
      task,
      prompt: "redacted prompt",
      run: {
        id: "run-1",
        taskId: task.id,
        status: "succeeded",
        role: "Development Agent",
        attempt: 1,
        promptReleaseId: "prompt-release-1",
        workspacePath: "/tmp/crs-src/runs/run-1",
        conversationId: "conversation-1",
        conversationUrl: "https://openhands.test/conversations/conversation-1",
        langfuseTraceId: "trace-1",
        langfuseTraceUrl: "https://langfuse.test/trace-1",
        summary: "Implemented and tested.",
        nextState: "Code Review",
        statusHistory: ["queued", "claimed", "running", "succeeded"],
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
        updatedAt: new Date("2026-06-18T00:00:00.000Z"),
      },
    });

    expect(validateLiveDispatchEvidence(evidence)).toEqual({ ok: true, errors: [] });
  });

  it("parses live dispatch JSON from package manager script output", () => {
    const output = [
      "$ tsx src/index.ts",
      JSON.stringify({
        task: { id: "task-1", planeId: "plane-1", repo: "crs-src" },
        run: {
          id: "run-1",
          status: "succeeded",
          role: "Development Agent",
          attempt: 1,
          promptReleaseId: "prompt-release-1",
          workspacePath: "/tmp/crs-src/runs/run-1",
          nextState: "Code Review",
          summary: "Implemented.",
        },
        verification: {
          runDetailPath: "/runs/run-1",
          planeEvidence: "plane-1",
          openHandsEvidence: "conversation-1",
          langfuseEvidence: "trace-1",
          expectedNextState: "Code Review",
        },
      }),
    ].join("\n");

    expect(parseLiveDispatchEvidence(output)).toMatchObject({
      task: { id: "task-1" },
      run: { id: "run-1" },
    });
  });

  it("rejects live dispatch evidence without OpenHands and Langfuse refs", () => {
    expect(
      validateLiveDispatchEvidence({
        task: { id: "task-1", planeId: "plane-1", repo: "crs-src" },
        run: {
          id: "run-1",
          status: "succeeded",
          role: "Development Agent",
          attempt: 1,
          promptReleaseId: "prompt-release-1",
          nextState: "Code Review",
          summary: "Implemented.",
        },
        verification: {
          runDetailPath: "/runs/run-1",
          planeEvidence: "plane-1",
          expectedNextState: "Code Review",
        },
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "verification.openHandsEvidence is required.",
        "verification.langfuseEvidence is required.",
      ]),
    });
  });

  it("allows failed live dispatch evidence only when debugging context is present", () => {
    expect(
      validateLiveDispatchEvidence({
        task: { id: "task-1", planeId: "plane-1", repo: "crs-src" },
        run: {
          id: "run-1",
          status: "failed",
          role: "Development Agent",
          attempt: 1,
          promptReleaseId: "prompt-release-1",
          workspacePath: "/tmp/crs-src/runs/run-1",
          conversationId: "conversation-1",
          error: "OpenHands timed out.",
        },
        verification: {
          runDetailPath: "/runs/run-1",
          planeEvidence: "plane-1",
          openHandsEvidence: "conversation-1",
          langfuseEvidence: "trace-1",
        },
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it("redacts runtime secrets before prompt release and tracing", async () => {
    const task = createMockTask({
      description: "Use OPENAI_API_KEY=sk-test1234567890abcdef before running tests.",
      comments: ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz"],
      workpad: "-----BEGIN PRIVATE KEY-----\nsecret-key-material\n-----END PRIVATE KEY-----",
    });
    const store = new InMemoryControlPlaneStore([task]);
    const worker = new DispatchWorker(
      loadConfig({ WORKER_MODE: "mock", WORKER_ENABLED_TEAMS: "token-team" }),
      store,
      new MockOpenHandsAdapter(),
      new MockTraceRecorder(),
    );

    await worker.dispatchOnce();

    const [run] = [...store.runs.values()];
    expect(run.promptSnapshot).toContain("OPENAI_API_KEY=[REDACTED_OPENAI_KEY]");
    expect(run.promptSnapshot).toContain("Authorization: Bearer [REDACTED_SECRET]");
    expect(run.promptSnapshot).toContain("[REDACTED_PRIVATE_KEY]");
    expect(run.promptSnapshot).not.toContain("sk-test1234567890abcdef");
    expect(run.promptSnapshot).not.toContain("secret-key-material");
  });

  it("redacts known token shapes in arbitrary runtime text", () => {
    expect(redactRuntimeSecrets("token: ghp_abcdefghijklmnopqrstuvwxyz123456")).toContain(
      "token: [REDACTED_SECRET]",
    );
    expect(redactRuntimeSecrets("aws=AKIAABCDEFGHIJKLMNOP")).toContain(
      "aws=[REDACTED_AWS_ACCESS_KEY]",
    );
  });

  it("does not dispatch an in-memory task after the configured attempt limit is reached", async () => {
    const task = createMockTask({ id: "task-dev-1", state: "Development" });
    const store = new InMemoryControlPlaneStore([task]);
    store.runs.set("run-failed-1", {
      id: "run-failed-1",
      taskId: task.id,
      role: "Development Agent",
      status: "failed",
      attempt: 1,
      statusHistory: ["failed"],
      createdAt: new Date("2026-06-18T00:00:00.000Z"),
      updatedAt: new Date("2026-06-18T00:00:00.000Z"),
    });

    const tasks = await store.findDispatchableTasks(
      loadConfig({
        WORKER_ENABLED_TEAMS: "token-team",
        WORKER_MAX_TASK_ATTEMPTS: "1",
      }),
    );

    expect(tasks).toEqual([]);
  });

  it("keeps OpenHands failure context when a run fails before tracing", async () => {
    const task = createMockTask({ id: "task-dev-1", state: "Development" });
    const store = new InMemoryControlPlaneStore([task]);
    const traces = {
      record: vi.fn(),
    };
    const worker = new DispatchWorker(
      loadConfig({ WORKER_MODE: "mock", WORKER_ENABLED_TEAMS: "token-team" }),
      store,
      {
        run: vi.fn().mockResolvedValue({
          status: "failed",
          conversationId: "conversation-failed-1",
          conversationUrl: "https://openhands.test/conversations/conversation-failed-1",
          eventCursor: "event-9",
          events: [
            {
              id: "event-9",
              conversationId: "conversation-failed-1",
              type: "run.status",
              status: "failed",
              createdAt: "2026-06-18T00:00:00.000Z",
            },
          ],
          summary: "Unit tests failed.",
        }),
      },
      traces,
    );

    await expect(worker.dispatchOnce()).rejects.toThrow("Unit tests failed.");

    const [run] = [...store.runs.values()];
    expect(run.status).toBe("failed");
    expect(run.conversationId).toBe("conversation-failed-1");
    expect(run.summary).toBe("Unit tests failed.");
    expect(run.statusHistory).toEqual(["queued", "claimed", "running", "failed"]);
    expect(traces.record).not.toHaveBeenCalled();
  });

  it("returns Code Review work with unresolved major feedback back to Development", () => {
    const task = createMockTask({
      state: "Code Review",
      comments: ["[feedback:code_review/major] 修复并发下重复提交的问题。"],
    });
    const worker = new DispatchWorker(
      loadConfig({ WORKER_MODE: "mock", WORKER_ENABLED_TEAMS: "token-team" }),
      new InMemoryControlPlaneStore([task]),
      new MockOpenHandsAdapter(),
      new MockTraceRecorder(),
    );

    const nextState = worker.decideNextState(
      task,
      {
        id: "run-review-1",
        taskId: task.id,
        role: "Review Agent",
        status: "running",
        attempt: 1,
        statusHistory: ["running"],
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
        updatedAt: new Date("2026-06-18T00:00:00.000Z"),
        workspacePath: "/workspace/crs-src/runs/run-1",
      },
      {
        status: "succeeded",
        conversationId: "conversation-review-1",
        summary: "Found defects.",
      },
    );

    expect(nextState).toBe("Development");
  });

  it("keeps successful release and deployment states on their human gates", () => {
    const worker = new DispatchWorker(
      loadConfig({ WORKER_MODE: "mock", WORKER_ENABLED_TEAMS: "token-team" }),
      new InMemoryControlPlaneStore([]),
      new MockOpenHandsAdapter(),
      new MockTraceRecorder(),
    );

    expect(
      worker.decideNextState(
        createMockTask({ state: "Release Version" }),
        {
          id: "run-release-1",
          taskId: "task-release-1",
          role: "Release Agent",
          status: "running",
          attempt: 1,
          statusHistory: ["running"],
          createdAt: new Date("2026-06-18T00:00:00.000Z"),
          updatedAt: new Date("2026-06-18T00:00:00.000Z"),
        },
        {
          status: "succeeded",
          conversationId: "conversation-release-1",
          summary: "Release prepared.",
        },
      ),
    ).toBe("Released");

    expect(
      worker.decideNextState(
        createMockTask({ state: "Deployment" }),
        {
          id: "run-deploy-1",
          taskId: "task-deploy-1",
          role: "Deploy Agent",
          status: "running",
          attempt: 1,
          statusHistory: ["running"],
          createdAt: new Date("2026-06-18T00:00:00.000Z"),
          updatedAt: new Date("2026-06-18T00:00:00.000Z"),
        },
        {
          status: "succeeded",
          conversationId: "conversation-deploy-1",
          summary: "Deployment finished.",
        },
      ),
    ).toBe("Deployed");
  });

  it("records throttled OpenHands poll heartbeats while a run is active", async () => {
    const task = createMockTask({ state: "Development" });
    const store = new InMemoryControlPlaneStore([task]);
    const heartbeatRun = vi.spyOn(store, "heartbeatRun");
    const worker = new DispatchWorker(
      loadConfig({
        WORKER_MODE: "mock",
        WORKER_ENABLED_TEAMS: "token-team",
        WORKER_HEARTBEAT_INTERVAL_MS: "0",
      }),
      store,
      {
        run: async (input) => {
          await input.onHeartbeat?.({
            conversationId: "conversation-1",
            attempt: 1,
            eventCursor: "event-1",
            eventsSeen: 2,
            newEvents: 2,
          });
          return {
            status: "succeeded",
            conversationId: "conversation-1",
            summary: "Implemented and tested.",
            suggestedNextState: "Code Review",
          };
        },
      },
      new MockTraceRecorder(),
    );

    await worker.dispatchOnce();

    const [run] = [...store.runs.values()];
    expect(run.summary).toBe("Implemented and tested.");
    expect(heartbeatRun).toHaveBeenCalledWith(
      run.id,
      900000,
      "OpenHands poll 1: 2 events seen, 2 new",
    );
  });

  it("keeps WORKER_MODE=mock on the in-memory path", () => {
    expect(loadConfig({ WORKER_MODE: "mock" }).mode).toBe("mock");
    expect(loadConfig({ WORKER_MODE: "live" }).mode).toBe("live");
    expect(loadConfig({}).mode).toBe("mock");
  });

  it("loads Plane polling fallback limits from env", () => {
    const config = loadConfig({
      PLANE_SYNC_MIN_INTERVAL_MS: "60000",
      PLANE_SYNC_PER_PAGE: "500",
    });

    expect(config.planeSyncMinIntervalMs).toBe(60_000);
    expect(config.planeSyncPerPage).toBe(100);
  });

  it("loads OpenHands endpoint paths from env", () => {
    const config = loadConfig({
      OPENHANDS_CONVERSATIONS_PATH: "/v1/conversations",
      OPENHANDS_RUNS_PATH: "/v1/runs",
    });

    expect(config.openHandsConversationsPath).toBe("/v1/conversations");
    expect(config.openHandsRunsPath).toBe("/v1/runs");
  });

  it("loads Langfuse endpoint paths from env", () => {
    const config = loadConfig({
      LANGFUSE_TRACES_PATH: "/v1/traces",
      LANGFUSE_GENERATIONS_PATH: "/v1/generations",
    });

    expect(config.langfuseTracesPath).toBe("/v1/traces");
    expect(config.langfuseGenerationsPath).toBe("/v1/generations");
  });

  it("fails fast when live runtime integrations are not configured", () => {
    const config = loadConfig({ WORKER_MODE: "live" });

    expect(() => createOpenHandsAdapter(config)).toThrow("OPENHANDS_BASE_URL");
    expect(() => createTraceRecorder(config)).toThrow("LANGFUSE_BASE_URL");
  });

  it("maps OpenHands SDK conversations and results into worker run results", async () => {
    const client = {
      createConversation: vi.fn().mockResolvedValue({
        id: "conversation-1",
        url: "https://openhands.test/conversations/conversation-1",
        repo: "crs-src",
        taskId: "task-1",
        runId: "run-1",
      }),
      startRun: vi.fn().mockResolvedValue(undefined),
      listEvents: vi.fn().mockResolvedValue({
        events: [
          {
            id: "event-1",
            conversationId: "conversation-1",
            type: "tool.call",
            toolName: "shell",
            input: { cmd: "pnpm test" },
            createdAt: "2026-06-18T00:00:00.000Z",
          },
        ],
        nextCursor: "event-1",
      }),
      getResult: vi.fn().mockResolvedValue({
        conversationId: "conversation-1",
        status: "completed",
        summary: "Implemented and tested.",
        eventCursor: "event-42",
      }),
    };
    const adapter = new OpenHandsRuntimeAdapter(client, {
      pollAttempts: 1,
      pollIntervalMs: 0,
    });
    const onHeartbeat = vi.fn().mockResolvedValue(undefined);

    const result = await adapter.run({
      task: createMockTask({ id: "task-1" }),
      run: {
        id: "run-1",
        taskId: "task-1",
        role: "Development Agent",
        status: "running",
        attempt: 1,
        statusHistory: ["running"],
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
        updatedAt: new Date("2026-06-18T00:00:00.000Z"),
      },
      prompt: "Implement task",
      workspaceRepo: "crs-src",
      workspacePath: "/workspace/crs-src/runs/run-1",
      onHeartbeat,
    });

    expect(client.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        runId: "run-1",
        repo: "crs-src",
        workspacePath: "/workspace/crs-src/runs/run-1",
        prompt: "Implement task",
        metadata: expect.objectContaining({
          role: "Development Agent",
          workspacePath: "/workspace/crs-src/runs/run-1",
        }),
      }),
    );
    expect(client.startRun).toHaveBeenCalledWith("conversation-1");
    expect(onHeartbeat).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      attempt: 1,
      eventCursor: "event-1",
      eventsSeen: 1,
      newEvents: 1,
    });
    expect(result).toEqual({
      status: "succeeded",
      conversationId: "conversation-1",
      conversationUrl: "https://openhands.test/conversations/conversation-1",
      eventCursor: "event-42",
      events: [
        {
          id: "event-1",
          conversationId: "conversation-1",
          type: "tool.call",
          toolName: "shell",
          input: { cmd: "pnpm test" },
          createdAt: "2026-06-18T00:00:00.000Z",
        },
      ],
      summary: "Implemented and tested.",
    });
  });

  it("records Langfuse traces for worker run metadata", async () => {
    const client = {
      startTrace: vi.fn().mockResolvedValue({
        traceId: "trace-1",
        url: "https://langfuse.test/trace-1",
        taskId: "task-1",
        runId: "run-1",
      }),
      recordGeneration: vi.fn().mockResolvedValue(undefined),
      finishTrace: vi.fn().mockResolvedValue({
        trace: { traceId: "trace-1" },
        usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
        cost: { inputCostUsd: 0.01, outputCostUsd: 0.02, totalCostUsd: 0.03, currency: "USD" },
        generationCount: 1,
      }),
      getTraceSummary: vi.fn().mockResolvedValue(undefined),
    };
    const recorder = new LangfuseTraceRecorder(client);

    const trace = await recorder.record({
      task: createMockTask({ id: "task-1" }),
      run: {
        id: "run-1",
        taskId: "task-1",
        role: "Development Agent",
        status: "running",
        attempt: 1,
        statusHistory: ["running"],
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
        updatedAt: new Date("2026-06-18T00:00:00.000Z"),
      },
      conversationId: "conversation-1",
      promptReleaseId: "prompt-release-1",
      model: "gpt-5.5 medium",
      repo: "crs-src",
      role: "Development Agent",
    });

    expect(client.startTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "agent-run:Development Agent",
        metadata: expect.objectContaining({
          taskId: "task-1",
          runId: "run-1",
          conversationId: "conversation-1",
          promptReleaseId: "prompt-release-1",
        }),
      }),
    );
    expect(client.recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        name: "openhands-run",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    );
    expect(client.finishTrace).toHaveBeenCalledWith("trace-1", {
      conversationId: "conversation-1",
    });
    expect(trace).toEqual({
      traceId: "trace-1",
      url: "https://langfuse.test/trace-1",
      inputTokens: 100,
      outputTokens: 25,
      costUsd: 0.03,
    });
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
        runs: [],
        feedbackItems: [
          {
            source: "code_review",
            severity: "major",
            body: "Fix failing unit tests.",
            externalUrl: "https://plane.test/comment-1",
          },
        ],
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
      run: {
        findMany: vi.fn().mockResolvedValue([]),
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
        comments: [
          "[feedback:code_review/major] Fix failing unit tests. (https://plane.test/comment-1)",
        ],
      }),
    ]);
  });

  it("applies repo concurrency policy before returning DB-backed dispatchable tasks", async () => {
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: "task-crs",
        externalTaskId: "plane-crs",
        title: "CRS task",
        url: "https://plane.test/token/TOK-1",
        state: "Development",
        priority: 10,
        createdAt: new Date("2026-06-18T10:00:00.000Z"),
        labels: ["repo:crs-src"],
        repositoryId: "repo-crs",
        runs: [],
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
      {
        id: "task-traffic",
        externalTaskId: "plane-traffic",
        title: "Traffic task",
        url: "https://plane.test/token/TOK-2",
        state: "Development",
        priority: 5,
        createdAt: new Date("2026-06-18T11:00:00.000Z"),
        labels: ["repo:traffic"],
        repositoryId: "repo-traffic",
        runs: [],
        repository: {
          slug: "traffic",
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
    const activeRunFindMany = vi.fn().mockResolvedValue([
      {
        taskId: "existing-task",
        costUsd: null,
        repository: {
          slug: "crs-src",
        },
        role: {
          name: "Development Agent",
        },
      },
    ]);
    const db = {
      task: {
        findMany: taskFindMany,
      },
      run: {
        findMany: activeRunFindMany,
      },
    } as unknown as DbClient;
    const store = new DbControlPlaneStore(db);

    const tasks = await store.findDispatchableTasks(
      loadConfig({
        WORKER_MODE: "live",
        WORKER_ENABLED_TEAMS: "token-team",
        WORKER_DEFAULT_REPO_CONCURRENCY: "1",
      }),
    );

    expect(activeRunFindMany).toHaveBeenCalled();
    expect(tasks.map((task) => task.id)).toEqual(["task-traffic"]);
  });

  it("blocks DB-backed tasks when estimated cost exceeds the configured budget", async () => {
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: "task-expensive",
        externalTaskId: "plane-expensive",
        title: "Expensive task",
        url: "https://plane.test/token/TOK-9",
        state: "Development",
        priority: 1,
        createdAt: new Date("2026-06-18T10:00:00.000Z"),
        labels: ["repo:crs-src", "cost:15"],
        repositoryId: "repo-crs",
        runs: [],
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
    const activeRunFindMany = vi.fn().mockResolvedValue([]);
    const taskUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = {
      task: {
        findMany: taskFindMany,
      },
      run: {
        findMany: activeRunFindMany,
      },
      $transaction: vi.fn(async (callback) => {
        return callback({
          task: {
            update: taskUpdate,
          },
          auditEvent: {
            create: auditCreate,
          },
        });
      }),
    } as unknown as DbClient;
    const store = new DbControlPlaneStore(db);

    const tasks = await store.findDispatchableTasks(
      loadConfig({
        WORKER_MODE: "live",
        WORKER_ENABLED_TEAMS: "token-team",
        WORKER_COST_BUDGET_LIMIT: "10",
        WORKER_COST_BUDGET_EXCEEDED_ACTION: "blocked",
      }),
    );

    expect(tasks).toEqual([]);
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "task-expensive" },
      data: { state: "Blocked" },
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "task.budget_blocked",
          entityId: "task-expensive",
          payload: expect.objectContaining({
            estimatedCost: 15,
            reason: "cost-budget-exceeded",
          }),
        }),
      }),
    );
  });

  it("does not return DB-backed tasks after the configured attempt limit is reached", async () => {
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: "task-exhausted",
        externalTaskId: "plane-exhausted",
        title: "Repeatedly failing task",
        url: "https://plane.test/token/TOK-3",
        state: "Development",
        priority: 1,
        createdAt: new Date("2026-06-18T10:00:00.000Z"),
        labels: ["repo:crs-src"],
        repositoryId: "repo-crs",
        runs: [
          {
            attempt: 3,
            status: "failed",
          },
        ],
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
      run: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as DbClient;
    const store = new DbControlPlaneStore(db);

    const tasks = await store.findDispatchableTasks(
      loadConfig({
        WORKER_MODE: "live",
        WORKER_ENABLED_TEAMS: "token-team",
        WORKER_MAX_TASK_ATTEMPTS: "3",
      }),
    );

    expect(tasks).toEqual([]);
  });

  it("returns DB-backed tasks when a retry cap has been manually released", async () => {
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: "task-released",
        externalTaskId: "plane-released",
        title: "Released task",
        url: "https://plane.test/token/TOK-4",
        state: "Development",
        priority: 1,
        createdAt: new Date("2026-06-18T10:00:00.000Z"),
        labels: ["repo:crs-src"],
        repositoryId: "repo-crs",
        retryAfterAttempt: 3,
        runs: [
          {
            attempt: 3,
            status: "failed",
          },
        ],
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
      run: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as DbClient;
    const store = new DbControlPlaneStore(db);

    const tasks = await store.findDispatchableTasks(
      loadConfig({
        WORKER_MODE: "live",
        WORKER_ENABLED_TEAMS: "token-team",
        WORKER_MAX_TASK_ATTEMPTS: "3",
      }),
    );

    expect(tasks.map((task) => task.id)).toEqual(["task-released"]);
  });

  it("assembles DB-backed prompt components in platform order", async () => {
    const db = {
      run: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run-1",
          roleId: "role-1",
          agentDefinitionId: "agent-1",
          repository: {
            id: "repo-1",
            project: {
              id: "project-1",
              team: {
                id: "team-1",
              },
            },
          },
        }),
      },
      promptBinding: {
        findMany: vi.fn().mockResolvedValue([
          {
            promptComponent: {
              id: "component-repo",
              scopeType: "repo",
              name: "repo-rules",
              version: 2,
              status: "active",
              content: "Use repository-specific constraints. secret: repo-secret-value",
            },
          },
        ]),
      },
      promptComponent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "component-global",
            scopeType: "global",
            name: "global-base",
            version: 1,
            status: "active",
            content: "Use Chinese for user-facing summaries.",
          },
        ]),
      },
    } as unknown as DbClient;
    const store = new DbControlPlaneStore(db);

    const assembly = await store.assemblePrompt(
      createMockTask(),
      {
        id: "run-1",
        taskId: "task-dev-1",
        status: "claimed",
        role: "Development",
        attempt: 1,
        statusHistory: ["claimed"],
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
        updatedAt: new Date("2026-06-18T00:00:00.000Z"),
      },
      "fallback prompt",
    );

    expect(assembly.content).toContain("<!-- prompt:global/global-base@v1 -->");
    expect(assembly.content).toContain("<!-- prompt:repo/repo-rules@v2 -->");
    expect(assembly.content).toContain("secret: [REDACTED_SECRET]");
    expect(assembly.content).not.toContain("repo-secret-value");
    expect(assembly.content.indexOf("global-base")).toBeLessThan(
      assembly.content.indexOf("repo-rules"),
    );
    expect(assembly.components).toEqual([
      expect.objectContaining({
        promptComponentId: "component-global",
        orderIndex: 0,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        promptComponentId: "component-repo",
        orderIndex: 1,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
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
          priority: 0,
          assignee: "bob-x",
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
      priority: 0,
      labels: ["repo:crs-src", "Feature"],
      assignee: "bob-x",
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
    const listTaskPage = vi.fn().mockResolvedValue({ results: payloads });
    const plane = {
      listTaskPage,
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

    expect(listTaskPage).toHaveBeenCalledWith({
      workspaceSlug: "acme",
      projectId: "project-plane-1",
      perPage: 10,
      cursor: undefined,
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

  it("paginates Plane polling fallback before upserting tasks", async () => {
    const listTaskPage = vi
      .fn()
      .mockResolvedValueOnce({
        nextCursor: "page-2",
        results: [
          {
            id: "plane-1",
            identifier: "TOK-1",
            name: "First page",
            state: { name: "Todo" },
            labels: [{ name: "repo:crs-src" }],
          },
        ] satisfies PlaneTaskPayload[],
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: "plane-2",
            identifier: "TOK-2",
            name: "Second page",
            state: { name: "Development" },
            labels: [{ name: "repo:traffic" }],
          },
        ] satisfies PlaneTaskPayload[],
      });
    const plane = {
      listTaskPage,
    } as unknown as PlaneClient;
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      $transaction: vi.fn(async (callback) => {
        return callback({
          project: {
            findFirst: vi.fn().mockResolvedValue({ id: "project-1" }),
          },
          repository: {
            findFirst: vi
              .fn()
              .mockResolvedValueOnce({ id: "repo-crs-src" })
              .mockResolvedValueOnce({ id: "repo-traffic" }),
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
      perPage: 1,
    });

    const result = await sync.sync();

    expect(listTaskPage).toHaveBeenNthCalledWith(1, {
      workspaceSlug: "acme",
      projectId: "project-plane-1",
      perPage: 1,
      cursor: undefined,
    });
    expect(listTaskPage).toHaveBeenNthCalledWith(2, {
      workspaceSlug: "acme",
      projectId: "project-plane-1",
      perPage: 1,
      cursor: "page-2",
    });
    expect(result).toEqual({ fetched: 2, upserted: 2, blockedMissingRepo: 0 });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("throttles Plane polling fallback inside the configured interval", async () => {
    let now = new Date("2026-06-18T10:00:00.000Z");
    const listTaskPage = vi.fn().mockResolvedValue({ results: [] });
    const sync = new PlaneTaskSyncService(
      {} as DbClient,
      { listTaskPage } as unknown as PlaneClient,
      {
        projectSlug: "token",
        workspaceSlug: "acme",
        projectId: "project-plane-1",
        minIntervalMs: 60_000,
        now: () => now,
      },
    );

    const first = await sync.sync();
    now = new Date("2026-06-18T10:00:30.000Z");
    const second = await sync.sync();

    expect(first).toEqual({ fetched: 0, upserted: 0, blockedMissingRepo: 0 });
    expect(second).toEqual({ fetched: 0, upserted: 0, blockedMissingRepo: 0 });
    expect(listTaskPage).toHaveBeenCalledTimes(1);
    expect(listTaskPage).toHaveBeenCalledWith({
      workspaceSlug: "acme",
      projectId: "project-plane-1",
      perPage: 100,
      cursor: undefined,
    });
  });

  it("uses the previous successful sync start as the Plane updatedSince cursor", async () => {
    let now = new Date("2026-06-18T10:00:00.000Z");
    const listTaskPage = vi.fn().mockResolvedValue({ results: [] });
    const sync = new PlaneTaskSyncService(
      {} as DbClient,
      { listTaskPage } as unknown as PlaneClient,
      {
        projectSlug: "token",
        workspaceSlug: "acme",
        projectId: "project-plane-1",
        perPage: 50,
        minIntervalMs: 60_000,
        now: () => now,
      },
    );

    await sync.sync();
    now = new Date("2026-06-18T10:01:00.000Z");
    await sync.sync();

    expect(listTaskPage).toHaveBeenNthCalledWith(2, {
      workspaceSlug: "acme",
      projectId: "project-plane-1",
      perPage: 50,
      updatedSince: "2026-06-18T10:00:00.000Z",
      cursor: undefined,
    });
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

  it("writes low-frequency claimed and running statuses back to Plane", async () => {
    const addComment = vi.fn().mockResolvedValue({ id: "comment-1", body: "ok" });
    const plane = {
      addComment,
    } as unknown as PlaneClient;
    const sync = new PlaneTaskSyncService({} as DbClient, plane, {
      projectSlug: "token",
    });
    const task = createMockTask({ planeId: "plane-1", state: "Development" });
    const run = {
      id: "run-1",
      taskId: task.id,
      status: "running" as const,
      role: "Development Agent",
      workerId: "worker-1",
      attempt: 1,
      statusHistory: ["running" as const],
      createdAt: new Date("2026-06-18T00:00:00.000Z"),
      updatedAt: new Date("2026-06-18T00:00:00.000Z"),
    };

    await sync.syncRunStatus(task, run, "Claimed");
    await sync.syncRunStatus(task, run, "Running");

    expect(addComment).toHaveBeenNthCalledWith(
      1,
      "plane-1",
      expect.stringContaining("Agent Status: Claimed"),
    );
    expect(addComment).toHaveBeenNthCalledWith(
      2,
      "plane-1",
      expect.stringContaining("Agent Status: Running"),
    );
    expect(addComment.mock.calls[1][1]).toContain("Worker: worker-1");
    expect(addComment.mock.calls[1][1]).toContain("Current State: Development");
  });
});
