import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  completeRun as dbCompleteRun,
  findDispatchableTasks as dbFindDispatchableTasks,
  markExpiredLeasesFailed as dbMarkExpiredLeasesFailed,
  markRunRunning as dbMarkRunRunning,
  prisma,
  recordRunObservabilityRefs as dbRecordRunObservabilityRefs,
  startRun as dbStartRun,
  upsertSyncedTask,
  type DbClient,
  type Run as DbRun,
  type TaskState as DbTaskState,
} from "@agent-control-plane/db";
import {
  HttpPlaneClient,
  normalizePlaneTask,
  type NormalizedPlaneTask,
  type PlaneClient,
} from "@agent-control-plane/plane";
import {
  LangfuseHttpAdapter,
  tokenUsage,
  type LangfuseAdapter as LangfuseClient,
} from "@agent-control-plane/langfuse";
import {
  HttpOpenHandsAdapter,
  type OpenHandsAdapter as OpenHandsClient,
} from "@agent-control-plane/openhands";
import {
  evaluateRuntimePolicy,
  type RuntimePolicyConfig,
} from "@agent-control-plane/runtime-policy";

export type TaskState =
  | "Backlog"
  | "Todo"
  | "Development"
  | "Code Review"
  | "Human Review"
  | "In Merge"
  | "Merged"
  | "Release Version"
  | "Released"
  | "Deployment"
  | "Deployed"
  | "Done"
  | "Canceled";

export type RunStatus = "queued" | "claimed" | "running" | "succeeded" | "failed" | "blocked";

export interface WorkerConfig {
  mode: "mock" | "live";
  workerId: string;
  enabledTeams: string[];
  leaseMs: number;
  openHandsBaseUrl?: string;
  openHandsApiKey?: string;
  openHandsPollIntervalMs: number;
  openHandsPollAttempts: number;
  langfuseBaseUrl?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  planeBaseUrl?: string;
  planeApiKey?: string;
  planeWorkspaceSlug?: string;
  planeProjectId?: string;
  projectSlug: string;
  defaultRepoConcurrency: number;
  defaultRoleConcurrency: number;
  costBudgetLimit?: number;
  costBudgetSpent?: number;
  costBudgetExceededAction: "waiting-approval" | "blocked";
}

export interface Task {
  id: string;
  planeId: string;
  team: string;
  project: string;
  repo?: string;
  title: string;
  description: string;
  state: TaskState;
  labels: string[];
  comments: string[];
  workpad?: string;
  blocked?: boolean;
  humanRequired?: boolean;
  activeRunId?: string;
}

export interface Run {
  id: string;
  taskId: string;
  status: RunStatus;
  role: string;
  workerId?: string;
  leaseExpiresAt?: Date;
  promptReleaseId?: string;
  promptSnapshot?: string;
  conversationId?: string;
  langfuseTraceId?: string;
  summary?: string;
  nextState?: TaskState;
  error?: string;
  statusHistory: RunStatus[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DispatchResult {
  task: Task;
  run: Run;
  prompt: string;
}

export interface ControlPlaneStore {
  syncFromPlane(): Promise<void>;
  findDispatchableTasks(config: WorkerConfig): Promise<Task[]>;
  claimRun(taskId: string, workerId: string, leaseMs: number): Promise<Run>;
  markRunRunning(runId: string, promptReleaseId: string, prompt: string): Promise<Run>;
  completeRun(
    runId: string,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<Run>;
  syncRunResult(
    task: Task,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<void>;
  failRun(runId: string, error: Error): Promise<Run>;
  updateTaskState(taskId: string, nextState: TaskState): Promise<Task>;
  getTask(taskId: string): Promise<Task | undefined>;
}

export interface OpenHandsAdapter {
  run(input: OpenHandsRunInput): Promise<OpenHandsRunResult>;
}

export interface OpenHandsRunInput {
  task: Task;
  run: Run;
  prompt: string;
  workspaceRepo: string;
}

export interface OpenHandsRunResult {
  status: "succeeded" | "failed";
  conversationId: string;
  conversationUrl?: string;
  eventCursor?: string;
  summary: string;
  suggestedNextState?: TaskState;
}

export interface TraceRecorder {
  record(input: TraceInput): Promise<TraceRef>;
}

export interface TraceInput {
  task: Task;
  run: Run;
  conversationId: string;
  promptReleaseId: string;
  model: string;
  repo: string;
  role: string;
}

export interface TraceRef {
  traceId: string;
  url?: string;
}

const automaticStates = new Set<TaskState>([
  "Todo",
  "Development",
  "Code Review",
  "In Merge",
  "Release Version",
  "Deployment",
]);

const roleByState: Record<string, string> = {
  Todo: "Intake",
  Development: "Development Agent",
  "Code Review": "Review Agent",
  "In Merge": "Merge Agent",
  "Release Version": "Release Agent",
  Deployment: "Deploy Agent",
};

const workerStateByDbState: Record<DbTaskState, TaskState> = {
  Todo: "Todo",
  Development: "Development",
  CodeReview: "Code Review",
  HumanReview: "Human Review",
  InMerge: "In Merge",
  Merged: "Merged",
  ReleaseVersion: "Release Version",
  Released: "Released",
  Deployment: "Deployment",
  Deployed: "Deployed",
  Done: "Done",
  Blocked: "Human Review",
  Canceled: "Canceled",
};

const dbStateByWorkerState: Partial<Record<TaskState, DbTaskState>> = {
  Todo: "Todo",
  Development: "Development",
  "Code Review": "CodeReview",
  "Human Review": "HumanReview",
  "In Merge": "InMerge",
  Merged: "Merged",
  "Release Version": "ReleaseVersion",
  Released: "Released",
  Deployment: "Deployment",
  Deployed: "Deployed",
  Done: "Done",
  Canceled: "Canceled",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const enabledTeams = (env.WORKER_ENABLED_TEAMS ?? "token-team")
    .split(",")
    .map((team) => team.trim())
    .filter(Boolean);

  return {
    mode: env.WORKER_MODE === "live" ? "live" : "mock",
    workerId: env.WORKER_ID ?? `worker-${process.pid}`,
    enabledTeams,
    leaseMs: Number(env.WORKER_LEASE_MS ?? 15 * 60 * 1000),
    openHandsBaseUrl: env.OPENHANDS_BASE_URL,
    openHandsApiKey: env.OPENHANDS_API_KEY,
    openHandsPollIntervalMs: numberFromEnv(env.OPENHANDS_POLL_INTERVAL_MS, 1000),
    openHandsPollAttempts: numberFromEnv(env.OPENHANDS_POLL_ATTEMPTS, 300),
    langfuseBaseUrl: env.LANGFUSE_BASE_URL,
    langfusePublicKey: env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: env.LANGFUSE_SECRET_KEY,
    planeBaseUrl: env.PLANE_BASE_URL,
    planeApiKey: env.PLANE_API_KEY,
    planeWorkspaceSlug: env.PLANE_WORKSPACE_SLUG,
    planeProjectId: env.PLANE_PROJECT_ID,
    projectSlug: env.CONTROL_PLANE_PROJECT_SLUG ?? "token",
    defaultRepoConcurrency: numberFromEnv(env.WORKER_DEFAULT_REPO_CONCURRENCY, 1),
    defaultRoleConcurrency: numberFromEnv(env.WORKER_DEFAULT_ROLE_CONCURRENCY, 2),
    costBudgetLimit: optionalNumberFromEnv(env.WORKER_COST_BUDGET_LIMIT),
    costBudgetSpent: optionalNumberFromEnv(env.WORKER_COST_BUDGET_SPENT),
    costBudgetExceededAction:
      env.WORKER_COST_BUDGET_EXCEEDED_ACTION === "blocked" ? "blocked" : "waiting-approval",
  };
}

export class DispatchWorker {
  constructor(
    private readonly config: WorkerConfig,
    private readonly store: ControlPlaneStore,
    private readonly openHands: OpenHandsAdapter,
    private readonly traces: TraceRecorder,
  ) {}

  async dispatchOnce(): Promise<DispatchResult | undefined> {
    await this.store.syncFromPlane();

    const [task] = await this.store.findDispatchableTasks(this.config);
    if (!task) {
      return undefined;
    }

    const claimedRun = await this.store.claimRun(
      task.id,
      this.config.workerId,
      this.config.leaseMs,
    );
    const prompt = this.assemblePrompt(task, claimedRun);
    const runningRun = await this.store.markRunRunning(
      claimedRun.id,
      this.createPromptReleaseId(task),
      prompt,
    );

    try {
      const openHandsResult = await this.openHands.run({
        task,
        run: runningRun,
        prompt,
        workspaceRepo: task.repo ?? "",
      });

      if (openHandsResult.status !== "succeeded") {
        throw new Error(openHandsResult.summary || "OpenHands run failed");
      }

      const traceRef = await this.traces.record({
        task,
        run: runningRun,
        conversationId: openHandsResult.conversationId,
        promptReleaseId: runningRun.promptReleaseId ?? "unknown",
        model: "gpt-5.5 medium",
        repo: task.repo ?? "unknown",
        role: runningRun.role,
      });

      const nextState = this.decideNextState(task, openHandsResult);
      const completedRun = await this.store.completeRun(
        runningRun.id,
        openHandsResult,
        traceRef,
        nextState,
      );
      await this.store.updateTaskState(task.id, nextState);
      await this.syncRunResultBestEffort(task, openHandsResult, traceRef, nextState);

      return {
        task: (await this.store.getTask(task.id)) ?? task,
        run: completedRun,
        prompt,
      };
    } catch (error) {
      await this.store.failRun(
        runningRun.id,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  assemblePrompt(task: Task, run: Run): string {
    const role = run.role;
    const comments =
      task.comments.length > 0
        ? task.comments.map((comment) => `- ${comment}`).join("\n")
        : "- none";

    return [
      "# Agent Control Plane Dispatch",
      "## Global Prompt",
      "You are an autonomous software worker executing one bounded task.",
      "## Team Prompt",
      `Team: ${task.team}`,
      "## Project Prompt",
      `Project: ${task.project}`,
      "## Repo Prompt",
      `Repository: ${task.repo}`,
      "## Role Prompt",
      `Role: ${role}`,
      "## Task Context",
      `Title: ${task.title}`,
      `Description: ${task.description}`,
      `Current State: ${task.state}`,
      "## Comments",
      comments,
      "## Workpad",
      task.workpad ?? "none",
      "## Runtime Constraints",
      "Use the assigned repo only. Record a concise summary and suggested next state when complete.",
    ].join("\n\n");
  }

  decideNextState(task: Task, result: OpenHandsRunResult): TaskState {
    if (result.suggestedNextState && isAllowedTransition(task.state, result.suggestedNextState)) {
      return result.suggestedNextState;
    }

    if (task.state === "Development") {
      return "Code Review";
    }

    if (task.state === "Todo") {
      return "Development";
    }

    return task.state;
  }

  private createPromptReleaseId(task: Task): string {
    return `prompt-release-${task.team}-${task.project}-${task.repo ?? "unknown"}-${Date.now()}`;
  }

  private async syncRunResultBestEffort(
    task: Task,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<void> {
    try {
      await this.store.syncRunResult(task, result, traceRef, nextState);
    } catch (error) {
      console.warn(
        `Failed to sync run result for task ${task.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  readonly tasks = new Map<string, Task>();
  readonly runs = new Map<string, Run>();

  constructor(initialTasks: Task[] = [createMockTask()]) {
    for (const task of initialTasks) {
      this.tasks.set(task.id, { ...task });
    }
  }

  async syncFromPlane(): Promise<void> {
    return;
  }

  async findDispatchableTasks(config: WorkerConfig): Promise<Task[]> {
    const now = Date.now();
    return [...this.tasks.values()].filter((task) => {
      const activeRun = task.activeRunId ? this.runs.get(task.activeRunId) : undefined;
      const hasActiveLease =
        activeRun?.leaseExpiresAt !== undefined &&
        activeRun.leaseExpiresAt.getTime() > now &&
        ["claimed", "running"].includes(activeRun.status);

      return (
        config.enabledTeams.includes(task.team) &&
        automaticStates.has(task.state) &&
        Boolean(task.repo) &&
        !task.blocked &&
        !task.humanRequired &&
        !hasActiveLease
      );
    });
  }

  async claimRun(taskId: string, workerId: string, leaseMs: number): Promise<Run> {
    const task = this.requireTask(taskId);
    const dispatchable = await this.findDispatchableTasks({
      mode: "mock",
      workerId,
      enabledTeams: [task.team],
      leaseMs,
      projectSlug: task.project,
      defaultRepoConcurrency: 1,
      defaultRoleConcurrency: 2,
      openHandsPollIntervalMs: 1000,
      openHandsPollAttempts: 300,
      costBudgetExceededAction: "waiting-approval",
    });

    if (!dispatchable.some((candidate) => candidate.id === taskId)) {
      throw new Error(`Task ${taskId} is not dispatchable`);
    }

    const now = new Date();
    const run: Run = {
      id: `run-${randomUUID()}`,
      taskId,
      status: "claimed",
      role: roleByState[task.state] ?? "Development Agent",
      workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      statusHistory: ["queued", "claimed"],
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    task.activeRunId = run.id;
    return { ...run };
  }

  async markRunRunning(runId: string, promptReleaseId: string, prompt: string): Promise<Run> {
    const run = this.requireRun(runId);
    run.status = "running";
    run.statusHistory.push("running");
    run.promptReleaseId = promptReleaseId;
    run.promptSnapshot = prompt;
    run.updatedAt = new Date();
    return { ...run };
  }

  async completeRun(
    runId: string,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<Run> {
    const run = this.requireRun(runId);
    run.status = "succeeded";
    run.statusHistory.push("succeeded");
    run.conversationId = result.conversationId;
    run.langfuseTraceId = traceRef.traceId;
    run.summary = result.summary;
    run.nextState = nextState;
    run.leaseExpiresAt = undefined;
    run.updatedAt = new Date();
    return { ...run };
  }

  async syncRunResult(): Promise<void> {
    return;
  }

  async failRun(runId: string, error: Error): Promise<Run> {
    const run = this.requireRun(runId);
    run.status = "failed";
    run.statusHistory.push("failed");
    run.error = error.message;
    run.leaseExpiresAt = undefined;
    run.updatedAt = new Date();
    return { ...run };
  }

  async updateTaskState(taskId: string, nextState: TaskState): Promise<Task> {
    const task = this.requireTask(taskId);
    task.state = nextState;
    task.activeRunId = undefined;
    return { ...task };
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  }

  private requireRun(runId: string): Run {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    return run;
  }
}

type DbTaskWithDispatchContext = Awaited<ReturnType<typeof dbFindDispatchableTasks>>[number];
type DbRunWithContext = DbRun & {
  role?: { name: string } | null;
  promptRelease?: { renderedContent: string } | null;
};

export class DbControlPlaneStore implements ControlPlaneStore {
  private readonly leaseOwners = new Map<string, string>();
  private readonly planeSync?: PlaneTaskSyncService;

  constructor(
    private readonly db: DbClient = prisma,
    options: { planeSync?: PlaneTaskSyncService } = {},
  ) {
    this.planeSync = options.planeSync;
  }

  async syncFromPlane(): Promise<void> {
    await dbMarkExpiredLeasesFailed(this.db);
    if (this.planeSync) {
      await this.planeSync.sync();
    }
    return;
  }

  async findDispatchableTasks(config: WorkerConfig): Promise<Task[]> {
    const tasks = await dbFindDispatchableTasks(this.db, { limit: 25 });
    const enabledTaskPairs = tasks
      .filter((task) => this.isEnabledTeam(task, config.enabledTeams))
      .map((task) => ({
        dbTask: task,
        workerTask: this.toWorkerTask(task),
      }));
    if (enabledTaskPairs.length === 0) {
      return [];
    }

    const activeRuns = await this.findActiveRunsForPolicy();
    const policy = evaluateRuntimePolicy(
      enabledTaskPairs.map(({ dbTask, workerTask }) => ({
        id: workerTask.id,
        repo: workerTask.repo ?? "missing-repo",
        role: roleByState[workerTask.state] ?? "Development Agent",
        priority: dbTask.priority ?? undefined,
        createdAt: dbTask.createdAt,
      })),
      activeRuns,
      runtimePolicyConfigFromWorkerConfig(config),
    );
    const allowedTaskIds = new Set(
      policy.dispatch
        .filter((decision) => decision.status === "allowed")
        .map((decision) => decision.task.id),
    );

    return enabledTaskPairs
      .map(({ workerTask }) => workerTask)
      .filter((task) => allowedTaskIds.has(task.id));
  }

  async claimRun(taskId: string, workerId: string, leaseMs: number): Promise<Run> {
    const run = await dbStartRun(this.db, {
      taskId,
      leaseOwner: workerId,
      leaseSeconds: Math.ceil(leaseMs / 1000),
    });

    this.leaseOwners.set(run.id, workerId);
    return this.toWorkerRun(run);
  }

  async markRunRunning(runId: string, _promptReleaseId: string, prompt: string): Promise<Run> {
    const leaseOwner = this.leaseOwners.get(runId);
    if (!leaseOwner) {
      throw new Error(`Run ${runId} has no lease owner in this worker`);
    }

    const run = await dbMarkRunRunning(this.db, {
      runId,
      leaseOwner,
      renderedPrompt: prompt,
    });

    return this.toWorkerRun(run);
  }

  async completeRun(
    runId: string,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<Run> {
    const run = await dbCompleteRun(this.db, {
      runId,
      status: "succeeded",
      resultSummary: result.summary,
      nextState: toDbTaskState(nextState),
    });
    await dbRecordRunObservabilityRefs(this.db, {
      runId,
      conversationId: result.conversationId,
      conversationUrl: result.conversationUrl,
      eventCursor: result.eventCursor,
      traceId: traceRef.traceId,
      traceUrl: traceRef.url,
      model: "gpt-5.5 medium",
      promptReleaseId: run.promptReleaseId,
    });

    this.leaseOwners.delete(runId);
    return {
      ...this.toWorkerRun(run),
      conversationId: result.conversationId,
      langfuseTraceId: traceRef.traceId,
      summary: result.summary,
      nextState,
    };
  }

  async syncRunResult(
    task: Task,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<void> {
    await this.planeSync?.syncRunResult(task, result, traceRef, nextState);
  }

  async failRun(runId: string, error: Error): Promise<Run> {
    const run = await dbCompleteRun(this.db, {
      runId,
      status: "failed",
      failureReason: error.message,
    });

    this.leaseOwners.delete(runId);
    return {
      ...this.toWorkerRun(run),
      error: error.message,
    };
  }

  async updateTaskState(taskId: string, nextState: TaskState): Promise<Task> {
    const task = await this.db.task.update({
      where: { id: taskId },
      data: { state: toDbTaskState(nextState) },
      include: {
        repository: true,
        project: {
          include: {
            team: true,
          },
        },
      },
    });

    return this.toWorkerTask(task);
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: {
        repository: true,
        project: {
          include: {
            team: true,
          },
        },
      },
    });

    return task ? this.toWorkerTask(task) : undefined;
  }

  private isEnabledTeam(task: DbTaskWithDispatchContext, enabledTeams: string[]): boolean {
    return enabledTeams.some((team) => {
      return (
        team === task.project.team.name ||
        team === task.project.team.key ||
        team === task.project.team.externalTeamId
      );
    });
  }

  private toWorkerTask(task: DbTaskWithDispatchContext): Task {
    return {
      id: task.id,
      planeId: task.externalTaskId,
      team: task.project.team.name,
      project: task.project.slug,
      repo: task.repository?.slug,
      title: task.title,
      description: task.url ? `Plane task: ${task.url}` : "",
      state: workerStateByDbState[task.state],
      labels: parseStringArray(task.labels),
      comments: [],
      blocked: task.state === "Blocked",
      humanRequired: task.state === "HumanReview",
    };
  }

  private toWorkerRun(run: DbRunWithContext): Run {
    return {
      id: run.id,
      taskId: run.taskId,
      status: run.status === "canceled" ? "failed" : run.status,
      role: run.role?.name ?? "Development Agent",
      workerId: run.leaseOwner ?? undefined,
      leaseExpiresAt: run.leaseExpiresAt ?? undefined,
      promptReleaseId: run.promptReleaseId,
      promptSnapshot: run.promptRelease?.renderedContent,
      summary: run.resultSummary ?? undefined,
      error: run.failureReason ?? undefined,
      nextState: run.nextState ? workerStateByDbState[run.nextState] : undefined,
      statusHistory: [run.status === "canceled" ? "failed" : run.status],
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private async findActiveRunsForPolicy() {
    const now = new Date();
    const runs = await this.db.run.findMany({
      where: {
        status: {
          in: ["claimed", "running"],
        },
        leaseExpiresAt: {
          gt: now,
        },
      },
      include: {
        repository: true,
        role: true,
      },
    });

    return runs.map((run) => ({
      taskId: run.taskId,
      repo: run.repository.slug,
      role: run.role.name,
      costSpent: Number(run.costUsd ?? 0),
    }));
  }
}

export type PlaneTaskSyncResult = {
  fetched: number;
  upserted: number;
  blockedMissingRepo: number;
};

export class PlaneTaskSyncService {
  constructor(
    private readonly db: DbClient,
    private readonly plane: PlaneClient,
    private readonly options: {
      projectSlug: string;
      workspaceSlug?: string;
      projectId?: string;
      perPage?: number;
    },
  ) {}

  async sync(): Promise<PlaneTaskSyncResult> {
    const payloads = await this.plane.listTasks({
      workspaceSlug: this.options.workspaceSlug,
      projectId: this.options.projectId,
      perPage: this.options.perPage ?? 50,
    });

    let upserted = 0;
    let blockedMissingRepo = 0;

    for (const payload of payloads) {
      const normalized = normalizePlaneTask(payload);
      if (!normalized.repo) {
        blockedMissingRepo += 1;
      }
      await upsertSyncedTask(
        this.db,
        normalizedPlaneTaskToDbInput(normalized, this.options.projectSlug),
      );
      upserted += 1;
    }

    return {
      fetched: payloads.length,
      upserted,
      blockedMissingRepo,
    };
  }

  async syncRunResult(
    task: Task,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<void> {
    await this.plane.updateTask(task.planeId, {
      stateName: workerTaskStateToPlaneStateName(nextState),
      summary: result.summary,
    });

    await this.plane.addComment(
      task.planeId,
      [
        "Agent Status: Completed",
        "",
        `Next State: ${workerTaskStateToPlaneStateName(nextState)}`,
        `Conversation: ${result.conversationId}`,
        `Trace: ${traceRef.url ?? traceRef.traceId}`,
        "",
        result.summary,
      ].join("\n"),
    );
  }
}

export function createPlaneTaskSyncService(
  config: WorkerConfig,
  db: DbClient = prisma,
): PlaneTaskSyncService | undefined {
  if (!config.planeBaseUrl || !config.planeWorkspaceSlug || !config.planeProjectId) {
    return undefined;
  }

  return new PlaneTaskSyncService(
    db,
    new HttpPlaneClient({
      baseUrl: config.planeBaseUrl,
      apiKey: config.planeApiKey,
      workspaceSlug: config.planeWorkspaceSlug,
      projectId: config.planeProjectId,
    }),
    {
      projectSlug: config.projectSlug,
      workspaceSlug: config.planeWorkspaceSlug,
      projectId: config.planeProjectId,
    },
  );
}

export function normalizedPlaneTaskToDbInput(
  task: NormalizedPlaneTask,
  projectSlug: string,
): Parameters<typeof upsertSyncedTask>[1] {
  return {
    projectSlug,
    externalTaskId: task.sourceId,
    identifier: task.identifier ?? task.sourceId,
    title: task.title,
    state: planeStateNameToDbTaskState(task.stateName),
    repositorySlug: task.repo,
    labels: task.labels,
    url: task.url,
  };
}

export function planeStateNameToDbTaskState(stateName?: string): DbTaskState {
  const normalized = normalizeStateName(stateName);
  const stateMap: Record<string, DbTaskState> = {
    todo: "Todo",
    backlog: "Todo",
    development: "Development",
    started: "Development",
    inprogress: "Development",
    codereview: "CodeReview",
    review: "CodeReview",
    humanreview: "HumanReview",
    human: "HumanReview",
    inmerge: "InMerge",
    merge: "InMerge",
    merged: "Merged",
    releaseversion: "ReleaseVersion",
    release: "ReleaseVersion",
    released: "Released",
    deployment: "Deployment",
    deploy: "Deployment",
    deployed: "Deployed",
    done: "Done",
    completed: "Done",
    blocked: "Blocked",
    canceled: "Canceled",
    cancelled: "Canceled",
  };

  return stateMap[normalized] ?? "Todo";
}

export function workerTaskStateToPlaneStateName(state: TaskState): string {
  return state;
}

export class MockOpenHandsAdapter implements OpenHandsAdapter {
  async run(input: OpenHandsRunInput): Promise<OpenHandsRunResult> {
    return {
      status: "succeeded",
      conversationId: `oh-${input.run.id}`,
      summary: `Mock OpenHands completed ${input.task.title} in ${input.workspaceRepo}.`,
      suggestedNextState: input.task.state === "Development" ? "Code Review" : undefined,
    };
  }
}

export class MockTraceRecorder implements TraceRecorder {
  async record(input: TraceInput): Promise<TraceRef> {
    return {
      traceId: `lf-${input.run.id}`,
      url: `mock://langfuse/traces/${input.run.id}`,
    };
  }
}

export class OpenHandsRuntimeAdapter implements OpenHandsAdapter {
  constructor(
    private readonly client: OpenHandsClient,
    private readonly options: {
      pollIntervalMs: number;
      pollAttempts: number;
    },
  ) {}

  async run(input: OpenHandsRunInput): Promise<OpenHandsRunResult> {
    const conversation = await this.client.createConversation({
      taskId: input.task.id,
      runId: input.run.id,
      repo: input.workspaceRepo,
      prompt: input.prompt,
      metadata: {
        role: input.run.role,
        state: input.task.state,
        project: input.task.project,
      },
    });
    await this.client.startRun(conversation.id);

    for (let attempt = 0; attempt < this.options.pollAttempts; attempt += 1) {
      const result = await this.client.getResult(conversation.id);
      if (result) {
        return {
          status: result.status === "completed" ? "succeeded" : "failed",
          conversationId: result.conversationId,
          conversationUrl: conversation.url,
          eventCursor: result.eventCursor,
          summary: result.error ?? result.summary,
        };
      }

      if (this.options.pollIntervalMs > 0) {
        await sleep(this.options.pollIntervalMs);
      }
    }

    return {
      status: "failed",
      conversationId: conversation.id,
      conversationUrl: conversation.url,
      summary: `OpenHands run did not complete after ${this.options.pollAttempts} polling attempts.`,
    };
  }
}

export class LangfuseTraceRecorder implements TraceRecorder {
  constructor(private readonly client: LangfuseClient) {}

  async record(input: TraceInput): Promise<TraceRef> {
    const trace = await this.client.startTrace({
      name: `agent-run:${input.role}`,
      metadata: {
        taskId: input.task.id,
        runId: input.run.id,
        conversationId: input.conversationId,
        promptReleaseId: input.promptReleaseId,
        repo: input.repo,
        role: input.role,
        model: input.model,
      },
    });
    await this.client.recordGeneration({
      traceId: trace.traceId,
      name: "openhands-run",
      model: input.model,
      input: { promptReleaseId: input.promptReleaseId },
      output: { conversationId: input.conversationId },
      usage: tokenUsage(0, 0),
    });
    await this.client.finishTrace(trace.traceId, { conversationId: input.conversationId });

    return {
      traceId: trace.traceId,
      url: trace.url,
    };
  }
}

export function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-dev-1",
    planeId: "plane-task-1",
    team: "token-team",
    project: "token",
    repo: "crs-src",
    title: "Implement worker MVP dry run",
    description: "Run one Development dispatch through mock OpenHands and record trace ref.",
    state: "Development",
    labels: ["repo:crs-src"],
    comments: ["MVP should run without Plane, database, or OpenHands."],
    workpad: "Use local interfaces until shared packages land.",
    ...overrides,
  };
}

function isAllowedTransition(from: TaskState, to: TaskState): boolean {
  if (to === "Done" || to === "Canceled") {
    return true;
  }

  const allowed: Record<TaskState, TaskState[]> = {
    Backlog: ["Todo"],
    Todo: ["Development"],
    Development: ["Code Review"],
    "Code Review": ["Development", "Human Review"],
    "Human Review": ["Development", "In Merge"],
    "In Merge": ["Merged"],
    Merged: ["Development", "Release Version"],
    "Release Version": ["Released"],
    Released: ["Development", "Deployment"],
    Deployment: ["Deployed"],
    Deployed: ["Development", "Done"],
    Done: [],
    Canceled: [],
  };

  return allowed[from].includes(to);
}

export async function runDryRun(): Promise<DispatchResult | undefined> {
  const config = loadConfig();
  const store =
    config.mode === "live"
      ? new DbControlPlaneStore(prisma, {
          planeSync: createPlaneTaskSyncService(config, prisma),
        })
      : new InMemoryControlPlaneStore();
  const worker = new DispatchWorker(
    config,
    store,
    createOpenHandsAdapter(config),
    createTraceRecorder(config),
  );
  return worker.dispatchOnce();
}

export function createOpenHandsAdapter(config: WorkerConfig): OpenHandsAdapter {
  if (config.mode !== "live") {
    return new MockOpenHandsAdapter();
  }

  if (!config.openHandsBaseUrl) {
    throw new Error("OPENHANDS_BASE_URL is required when WORKER_MODE=live");
  }

  return new OpenHandsRuntimeAdapter(
    new HttpOpenHandsAdapter({
      baseUrl: config.openHandsBaseUrl,
      headers: config.openHandsApiKey ? { authorization: `Bearer ${config.openHandsApiKey}` } : {},
    }),
    {
      pollIntervalMs: config.openHandsPollIntervalMs,
      pollAttempts: config.openHandsPollAttempts,
    },
  );
}

export function createTraceRecorder(config: WorkerConfig): TraceRecorder {
  if (config.mode !== "live") {
    return new MockTraceRecorder();
  }

  if (!config.langfuseBaseUrl || !config.langfusePublicKey || !config.langfuseSecretKey) {
    throw new Error(
      "LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY are required when WORKER_MODE=live",
    );
  }

  return new LangfuseTraceRecorder(
    new LangfuseHttpAdapter({
      baseUrl: config.langfuseBaseUrl,
      publicKey: config.langfusePublicKey,
      secretKey: config.langfuseSecretKey,
    }),
  );
}

function toDbTaskState(state: TaskState): DbTaskState {
  const dbState = dbStateByWorkerState[state];
  if (!dbState) {
    throw new Error(`Task state ${state} is not persisted in the DB schema`);
  }
  return dbState;
}

function runtimePolicyConfigFromWorkerConfig(config: WorkerConfig): RuntimePolicyConfig {
  return {
    defaultRepoConcurrency: config.defaultRepoConcurrency,
    defaultRoleConcurrency: config.defaultRoleConcurrency,
    costBudget:
      config.costBudgetLimit === undefined
        ? undefined
        : {
            limit: config.costBudgetLimit,
            spent: config.costBudgetSpent,
            onExceeded: config.costBudgetExceededAction,
          },
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = optionalNumberFromEnv(value);
  return parsed ?? fallback;
}

function optionalNumberFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeStateName(stateName?: string): string {
  return (stateName ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .trim();
}

async function main(): Promise<void> {
  const result = await runDryRun();
  if (!result) {
    console.log("No dispatchable tasks found.");
    return;
  }

  console.log(
    JSON.stringify(
      {
        taskId: result.task.id,
        taskState: result.task.state,
        runId: result.run.id,
        runStatus: result.run.status,
        conversationId: result.run.conversationId,
        langfuseTraceId: result.run.langfuseTraceId,
        nextState: result.run.nextState,
        summary: result.run.summary,
      },
      null,
      2,
    ),
  );
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
