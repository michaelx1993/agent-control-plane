import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  completeRun as dbCompleteRun,
  findDispatchableTasks as dbFindDispatchableTasks,
  heartbeatRun as dbHeartbeatRun,
  markExpiredLeasesFailed as dbMarkExpiredLeasesFailed,
  markRunRunning as dbMarkRunRunning,
  recordRunConversationRef as dbRecordRunConversationRef,
  prisma,
  recordRunObservabilityRefs as dbRecordRunObservabilityRefs,
  recordRunExternalEvents as dbRecordRunExternalEvents,
  startRun as dbStartRun,
  upsertSyncedTask,
  type DbClient,
  type Run as DbRun,
  type TaskState as DbTaskState,
} from "@agent-control-plane/db";
import {
  HttpPlaneClient,
  createPlaneLabelResolver,
  normalizePlaneTask,
  type ListPlaneTasksParams,
  type NormalizedPlaneTask,
  type PlaneClient,
  type PlaneLabelResolver,
  type PlaneTaskPayload,
} from "@agent-control-plane/plane";
import {
  LangfuseHttpAdapter,
  tokenUsage,
  type LangfuseAdapter as LangfuseClient,
} from "@agent-control-plane/langfuse";
import {
  HttpOpenHandsAdapter,
  type OpenHandsEvent as OpenHandsRuntimeEvent,
  type OpenHandsAdapter as OpenHandsClient,
} from "@agent-control-plane/openhands";
import {
  evaluateRuntimePolicy,
  type RuntimePolicyDecision,
  type RuntimePolicyConfig,
} from "@agent-control-plane/runtime-policy";
import { planWorkflowClosure, validateTransition } from "@agent-control-plane/state-machine";
import type { AgentRoleKey } from "@agent-control-plane/shared";

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
  | "Blocked"
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
  openHandsConversationsPath?: string;
  openHandsRunsPath?: string;
  openHandsPollIntervalMs: number;
  openHandsPollAttempts: number;
  workerHeartbeatIntervalMs: number;
  workerLoopIntervalMs: number;
  maxTaskAttempts: number;
  langfuseBaseUrl?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseTracesPath?: string;
  langfuseGenerationsPath?: string;
  planeBaseUrl?: string;
  planeApiKey?: string;
  planeApiKeyHeader: string;
  planeWorkspaceSlug?: string;
  planeProjectId?: string;
  planeSyncMinIntervalMs: number;
  planeSyncPerPage: number;
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
  workspacePath?: string;
  conversationId?: string;
  conversationUrl?: string;
  langfuseTraceId?: string;
  langfuseTraceUrl?: string;
  summary?: string;
  nextState?: TaskState;
  error?: string;
  attempt: number;
  statusHistory: RunStatus[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DispatchResult {
  task: Task;
  run: Run;
  prompt: string;
  planeSync?: PlaneSyncEvidence;
}

export interface PlaneSyncEvidence {
  taskId: string;
  stateName: string;
  commentId?: string;
  commentBody?: string;
}

export interface PromptAssemblyComponent {
  promptComponentId: string;
  orderIndex: number;
  contentHash: string;
}

export interface PromptAssembly {
  content: string;
  components: PromptAssemblyComponent[];
}

export interface ControlPlaneStore {
  syncFromPlane(): Promise<void>;
  findDispatchableTasks(config: WorkerConfig): Promise<Task[]>;
  claimRun(taskId: string, workerId: string, leaseMs: number): Promise<Run>;
  assemblePrompt(task: Task, run: Run, fallbackPrompt: string): Promise<PromptAssembly>;
  markRunRunning(
    runId: string,
    promptReleaseId: string,
    prompt: string,
    components?: PromptAssemblyComponent[],
  ): Promise<Run>;
  heartbeatRun(runId: string, leaseMs: number, message?: string): Promise<Run>;
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
  ): Promise<PlaneSyncEvidence | undefined>;
  syncRunStatus(task: Task, run: Run, status: "Claimed" | "Running" | "Failed"): Promise<void>;
  failRun(runId: string, error: Error, result?: OpenHandsRunResult): Promise<Run>;
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
  workspacePath?: string;
  onHeartbeat?: (heartbeat: OpenHandsHeartbeat) => Promise<void> | void;
}

export interface OpenHandsHeartbeat {
  conversationId: string;
  attempt: number;
  eventCursor?: string;
  eventsSeen: number;
  newEvents: number;
}

export interface OpenHandsRunResult {
  status: "succeeded" | "failed";
  conversationId: string;
  conversationUrl?: string;
  eventCursor?: string;
  events?: OpenHandsRuntimeEvent[];
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
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
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
  Blocked: "Blocked",
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
  Blocked: "Blocked",
  Done: "Done",
  Canceled: "Canceled",
};

const promptScopeOrder = ["global", "team", "project", "repo", "role", "agent"] as const;

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
    openHandsConversationsPath: env.OPENHANDS_CONVERSATIONS_PATH,
    openHandsRunsPath: env.OPENHANDS_RUNS_PATH,
    openHandsPollIntervalMs: numberFromEnv(env.OPENHANDS_POLL_INTERVAL_MS, 1000),
    openHandsPollAttempts: numberFromEnv(env.OPENHANDS_POLL_ATTEMPTS, 300),
    workerHeartbeatIntervalMs: numberFromEnv(env.WORKER_HEARTBEAT_INTERVAL_MS, 30_000),
    workerLoopIntervalMs: numberFromEnv(env.WORKER_LOOP_INTERVAL_MS, 60_000),
    maxTaskAttempts: numberFromEnv(env.WORKER_MAX_TASK_ATTEMPTS, 3),
    langfuseBaseUrl: env.LANGFUSE_BASE_URL,
    langfusePublicKey: env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: env.LANGFUSE_SECRET_KEY,
    langfuseTracesPath: env.LANGFUSE_TRACES_PATH,
    langfuseGenerationsPath: env.LANGFUSE_GENERATIONS_PATH,
    planeBaseUrl: env.PLANE_BASE_URL,
    planeApiKey: env.PLANE_API_KEY,
    planeApiKeyHeader: env.PLANE_API_KEY_HEADER ?? "X-API-Key",
    planeWorkspaceSlug: env.PLANE_WORKSPACE_SLUG,
    planeProjectId: env.PLANE_PROJECT_ID,
    planeSyncMinIntervalMs: numberFromEnv(env.PLANE_SYNC_MIN_INTERVAL_MS, 60_000),
    planeSyncPerPage: planePerPageFromEnv(env.PLANE_SYNC_PER_PAGE, 100),
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
    await this.syncRunStatusBestEffort(task, claimedRun, "Claimed");
    const fallbackPrompt = this.assemblePrompt(task, claimedRun);
    const promptAssembly = await this.store.assemblePrompt(task, claimedRun, fallbackPrompt);
    const runningRun = await this.store.markRunRunning(
      claimedRun.id,
      this.createPromptReleaseId(task),
      promptAssembly.content,
      promptAssembly.components,
    );
    await this.syncRunStatusBestEffort(task, runningRun, "Running");
    const heartbeat = this.createHeartbeatReporter(runningRun.id);
    let failureRecorded = false;

    try {
      const openHandsResult = await this.openHands.run({
        task,
        run: runningRun,
        prompt: promptAssembly.content,
        workspaceRepo: task.repo ?? "",
        workspacePath: runningRun.workspacePath,
        onHeartbeat: heartbeat,
      });

      if (openHandsResult.status !== "succeeded") {
        const error = new Error(openHandsResult.summary || "OpenHands run failed");
        const failedRun = await this.store.failRun(runningRun.id, error, openHandsResult);
        failureRecorded = true;
        await this.syncRunStatusBestEffort(task, failedRun, "Failed");
        throw error;
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

      const nextState = this.decideNextState(task, runningRun, openHandsResult);
      let planeSync: PlaneSyncEvidence | undefined;
      if (this.config.mode === "live") {
        try {
          planeSync = await this.store.syncRunResult(task, openHandsResult, traceRef, nextState);
        } catch (error) {
          const syncError =
            error instanceof Error
              ? error
              : new Error(`Failed to sync run result: ${String(error)}`);
          const failedRun = await this.store.failRun(runningRun.id, syncError, openHandsResult);
          failureRecorded = true;
          await this.syncRunStatusBestEffort(task, failedRun, "Failed");
          throw syncError;
        }
      }

      const completedRun = await this.store.completeRun(
        runningRun.id,
        openHandsResult,
        traceRef,
        nextState,
      );
      await this.store.updateTaskState(task.id, nextState);
      if (this.config.mode !== "live") {
        planeSync = await this.syncRunResultBestEffort(task, openHandsResult, traceRef, nextState);
      }

      return {
        task: (await this.store.getTask(task.id)) ?? task,
        run: completedRun,
        prompt: promptAssembly.content,
        planeSync,
      };
    } catch (error) {
      if (!failureRecorded) {
        const failedRun = await this.store.failRun(
          runningRun.id,
          error instanceof Error ? error : new Error(String(error)),
        );
        await this.syncRunStatusBestEffort(task, failedRun, "Failed");
      }
      throw error;
    }
  }

  assemblePrompt(task: Task, run: Run): string {
    const role = run.role;
    const comments =
      task.comments.length > 0
        ? task.comments.map((comment) => `- ${comment}`).join("\n")
        : "- none";

    return redactRuntimeSecrets(
      [
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
      ].join("\n\n"),
    );
  }

  decideNextState(task: Task, run: Run, result: OpenHandsRunResult): TaskState {
    if (
      result.suggestedNextState &&
      isAllowedWorkerTransition(task.state, result.suggestedNextState)
    ) {
      return result.suggestedNextState;
    }

    const closure = planWorkflowClosure({
      taskState: task.state,
      role: roleKeyFromRunRole(run.role),
      openHandsResult: {
        status: result.status === "succeeded" ? "completed" : "failed",
      },
      unresolvedFeedback: unresolvedFeedbackFromTask(task),
    });
    if (closure.ok && closure.value.allowedTransition) {
      return closure.value.nextState as TaskState;
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
  ): Promise<PlaneSyncEvidence | undefined> {
    try {
      return await this.store.syncRunResult(task, result, traceRef, nextState);
    } catch (error) {
      console.warn(
        `Failed to sync run result for task ${task.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private async syncRunStatusBestEffort(
    task: Task,
    run: Run,
    status: "Claimed" | "Running" | "Failed",
  ): Promise<void> {
    try {
      await this.store.syncRunStatus(task, run, status);
    } catch (error) {
      console.warn(
        `Failed to sync run status ${status} for task ${task.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private createHeartbeatReporter(runId: string) {
    let lastHeartbeatAt = 0;

    return async (heartbeat: OpenHandsHeartbeat): Promise<void> => {
      const now = Date.now();
      if (
        this.config.workerHeartbeatIntervalMs > 0 &&
        now - lastHeartbeatAt < this.config.workerHeartbeatIntervalMs
      ) {
        return;
      }
      lastHeartbeatAt = now;

      try {
        await this.store.heartbeatRun(
          runId,
          this.config.leaseMs,
          `OpenHands poll ${heartbeat.attempt}: ${heartbeat.eventsSeen} events seen, ${heartbeat.newEvents} new`,
        );
      } catch (error) {
        console.warn(
          `Failed to heartbeat run ${runId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };
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

  async assemblePrompt(_task: Task, _run: Run, fallbackPrompt: string): Promise<PromptAssembly> {
    return {
      content: fallbackPrompt,
      components: [],
    };
  }

  async findDispatchableTasks(config: WorkerConfig): Promise<Task[]> {
    const now = Date.now();
    return [...this.tasks.values()].filter((task) => {
      const activeRun = task.activeRunId ? this.runs.get(task.activeRunId) : undefined;
      const hasActiveLease =
        activeRun?.leaseExpiresAt !== undefined &&
        activeRun.leaseExpiresAt.getTime() > now &&
        ["claimed", "running"].includes(activeRun.status);
      const maxAttempt = Math.max(
        0,
        ...[...this.runs.values()]
          .filter((run) => run.taskId === task.id)
          .map((run) => run.attempt),
      );

      return (
        config.enabledTeams.includes(task.team) &&
        automaticStates.has(task.state) &&
        Boolean(task.repo) &&
        !task.blocked &&
        !task.humanRequired &&
        !hasActiveLease &&
        maxAttempt < config.maxTaskAttempts
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
      planeApiKeyHeader: "X-API-Key",
      planeSyncMinIntervalMs: 60_000,
      planeSyncPerPage: 100,
      projectSlug: task.project,
      defaultRepoConcurrency: 1,
      defaultRoleConcurrency: 2,
      openHandsPollIntervalMs: 1000,
      openHandsPollAttempts: 300,
      workerHeartbeatIntervalMs: 30_000,
      workerLoopIntervalMs: 60_000,
      maxTaskAttempts: 3,
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
      attempt:
        Math.max(
          0,
          ...[...this.runs.values()]
            .filter((candidate) => candidate.taskId === taskId)
            .map((candidate) => candidate.attempt),
        ) + 1,
      statusHistory: ["queued", "claimed"],
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    task.activeRunId = run.id;
    return { ...run };
  }

  async markRunRunning(
    runId: string,
    promptReleaseId: string,
    prompt: string,
    _components: PromptAssemblyComponent[] = [],
  ): Promise<Run> {
    const run = this.requireRun(runId);
    run.status = "running";
    run.statusHistory.push("running");
    run.promptReleaseId = promptReleaseId;
    run.promptSnapshot = prompt;
    run.updatedAt = new Date();
    return { ...run };
  }

  async heartbeatRun(runId: string, leaseMs: number, message = "Run heartbeat"): Promise<Run> {
    const run = this.requireRun(runId);
    const now = new Date();
    run.status = "running";
    run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
    run.updatedAt = now;
    run.summary = message;
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
    run.conversationUrl = result.conversationUrl;
    run.langfuseTraceId = traceRef.traceId;
    run.langfuseTraceUrl = traceRef.url;
    run.summary = result.summary;
    run.nextState = nextState;
    run.leaseExpiresAt = undefined;
    run.updatedAt = new Date();
    return { ...run };
  }

  async syncRunResult(
    task: Task,
    _result: OpenHandsRunResult,
    _traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<PlaneSyncEvidence> {
    return {
      taskId: task.planeId,
      stateName: workerTaskStateToPlaneStateName(nextState),
    };
  }

  async syncRunStatus(): Promise<void> {
    return;
  }

  async failRun(runId: string, error: Error, result?: OpenHandsRunResult): Promise<Run> {
    const run = this.requireRun(runId);
    run.status = "failed";
    run.statusHistory.push("failed");
    run.error = error.message;
    run.conversationId = result?.conversationId;
    run.conversationUrl = result?.conversationUrl;
    run.summary = result?.summary ?? error.message;
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
type DbTaskWithWorkerContext = {
  id: string;
  externalTaskId: string;
  title: string;
  url: string | null;
  state: DbTaskState;
  labels: unknown;
  retryAfterAttempt?: number;
  repository?: { slug: string } | null;
  project: {
    slug: string;
    team: {
      name: string;
      key: string;
      externalTeamId: string;
    };
  };
  feedbackItems?: Array<{
    source: string;
    severity: string;
    body: string;
    externalUrl: string | null;
  }>;
};
type DbRunWithContext = DbRun & {
  role?: { name: string } | null;
  promptRelease?: { renderedContent: string } | null;
  workspace?: { path: string } | null;
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
    await dbMarkExpiredLeasesFailed(this.db, {
      expiredStatus: "blocked",
      failureReason: "Lease expired without heartbeat; marked stalled",
    });
    if (this.planeSync) {
      await this.planeSync.sync();
    }
    return;
  }

  async findDispatchableTasks(config: WorkerConfig): Promise<Task[]> {
    const tasks = await dbFindDispatchableTasks(this.db, { limit: 100 });
    const enabledTaskPairs = tasks
      .filter((task) => this.isEnabledTeam(task, config.enabledTeams))
      .filter((task) => this.hasAttemptsRemaining(task, config.maxTaskAttempts))
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
        estimatedCost: estimatedCostFromLabels(workerTask.labels),
      })),
      activeRuns,
      runtimePolicyConfigFromWorkerConfig(config),
    );
    await this.persistBudgetBlocks(policy.dispatch);
    const allowedTaskIds = new Set(
      policy.dispatch
        .filter((decision) => decision.status === "allowed")
        .map((decision) => decision.task.id),
    );

    return enabledTaskPairs
      .map(({ workerTask }) => workerTask)
      .filter((task) => allowedTaskIds.has(task.id));
  }

  private async persistBudgetBlocks(decisions: RuntimePolicyDecision[]): Promise<void> {
    const blockedDecisions = decisions.filter(
      (decision) => decision.reason === "cost-budget-exceeded" && decision.status === "blocked",
    );
    if (blockedDecisions.length === 0) {
      return;
    }

    await Promise.all(
      blockedDecisions.map((decision) =>
        this.db.$transaction(async (tx) => {
          await tx.task.update({
            where: {
              id: decision.task.id,
            },
            data: {
              state: "Blocked",
            },
          });
          await tx.auditEvent.create({
            data: {
              action: "task.budget_blocked",
              entityType: "task",
              entityId: decision.task.id,
              message: "Task blocked by cost budget policy",
              payload: {
                reason: decision.reason,
                status: decision.status,
                estimatedCost: decision.task.estimatedCost ?? null,
                repo: decision.task.repo,
                role: decision.task.role,
              },
            },
          });
        }),
      ),
    );
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

  async assemblePrompt(_task: Task, run: Run, fallbackPrompt: string): Promise<PromptAssembly> {
    const context = await this.loadDbPromptContext(run.id);
    if (!context) {
      return {
        content: fallbackPrompt,
        components: [],
      };
    }

    const promptComponents = await this.loadPromptComponentsForRun(context);
    if (promptComponents.length === 0) {
      return {
        content: fallbackPrompt,
        components: [],
      };
    }

    const renderedComponents = promptComponents.map((component, index) => {
      const content = redactRuntimeSecrets(component.content.trim());
      return {
        promptComponentId: component.id,
        orderIndex: index,
        contentHash: sha256Hex(content),
        heading: `<!-- prompt:${component.scopeType}/${component.name}@v${component.version} -->`,
        content,
      };
    });

    return {
      content: redactRuntimeSecrets(
        [
          "# Agent Control Plane Dispatch",
          "## Platform Prompt",
          ...renderedComponents.map((component) =>
            [component.heading, component.content].join("\n"),
          ),
          "## Task Context",
          fallbackPrompt,
        ].join("\n\n"),
      ),
      components: renderedComponents.map((component) => ({
        promptComponentId: component.promptComponentId,
        orderIndex: component.orderIndex,
        contentHash: component.contentHash,
      })),
    };
  }

  async markRunRunning(
    runId: string,
    _promptReleaseId: string,
    prompt: string,
    components: PromptAssemblyComponent[] = [],
  ): Promise<Run> {
    const leaseOwner = this.leaseOwners.get(runId);
    if (!leaseOwner) {
      throw new Error(`Run ${runId} has no lease owner in this worker`);
    }

    const run = await dbMarkRunRunning(this.db, {
      runId,
      leaseOwner,
      renderedPrompt: prompt,
      components,
    });

    return this.toWorkerRun(run);
  }

  async heartbeatRun(runId: string, leaseMs: number, message?: string): Promise<Run> {
    const leaseOwner = this.leaseOwners.get(runId);
    if (!leaseOwner) {
      throw new Error(`Run ${runId} has no lease owner in this worker`);
    }

    const run = await dbHeartbeatRun(this.db, {
      runId,
      leaseOwner,
      leaseSeconds: Math.ceil(leaseMs / 1000),
      message,
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
      tokenInput: traceRef.inputTokens,
      tokenOutput: traceRef.outputTokens,
      costUsd: traceRef.costUsd,
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
      inputTokens: traceRef.inputTokens,
      outputTokens: traceRef.outputTokens,
      costUsd: traceRef.costUsd,
    });
    await dbRecordRunExternalEvents(this.db, {
      runId,
      source: "openhands",
      events: (result.events ?? []).map((event) => openHandsEventToRunEventInput(event)),
    });

    this.leaseOwners.delete(runId);
    return {
      ...this.toWorkerRun(run),
      conversationId: result.conversationId,
      conversationUrl: result.conversationUrl,
      langfuseTraceId: traceRef.traceId,
      langfuseTraceUrl: traceRef.url,
      summary: result.summary,
      nextState,
    };
  }

  async syncRunResult(
    task: Task,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<PlaneSyncEvidence | undefined> {
    return this.planeSync?.syncRunResult(task, result, traceRef, nextState);
  }

  async syncRunStatus(task: Task, run: Run, status: "Claimed" | "Running" | "Failed") {
    await this.planeSync?.syncRunStatus(task, run, status);
  }

  async failRun(runId: string, error: Error, result?: OpenHandsRunResult): Promise<Run> {
    const run = await dbCompleteRun(this.db, {
      runId,
      status: "failed",
      resultSummary: result?.summary,
      failureReason: error.message,
    });
    if (result?.conversationId) {
      await dbRecordRunConversationRef(this.db, {
        runId,
        conversationId: result.conversationId,
        conversationUrl: result.conversationUrl,
        eventCursor: result.eventCursor,
      });
      await dbRecordRunExternalEvents(this.db, {
        runId,
        source: "openhands",
        events: (result.events ?? []).map((event) => openHandsEventToRunEventInput(event)),
      });
    }

    this.leaseOwners.delete(runId);
    return {
      ...this.toWorkerRun(run),
      conversationId: result?.conversationId,
      conversationUrl: result?.conversationUrl,
      summary: result?.summary,
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
        feedbackItems: {
          where: {
            resolvedAt: null,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 20,
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
        feedbackItems: {
          where: {
            resolvedAt: null,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 20,
        },
      },
    });

    return task ? this.toWorkerTask(task) : undefined;
  }

  private isEnabledTeam(task: DbTaskWithWorkerContext, enabledTeams: string[]): boolean {
    return enabledTeams.some((team) => {
      return (
        team === task.project.team.name ||
        team === task.project.team.key ||
        team === task.project.team.externalTeamId
      );
    });
  }

  private hasAttemptsRemaining(task: DbTaskWithDispatchContext, maxTaskAttempts: number): boolean {
    const maxAttempt = Math.max(0, ...task.runs.map((run) => run.attempt));
    return maxAttempt - (task.retryAfterAttempt ?? 0) < maxTaskAttempts;
  }

  private toWorkerTask(task: DbTaskWithWorkerContext): Task {
    const feedbackComments =
      "feedbackItems" in task && Array.isArray(task.feedbackItems)
        ? task.feedbackItems.map(
            (feedback) =>
              `[feedback:${feedback.source}/${feedback.severity}] ${feedback.body}${
                feedback.externalUrl ? ` (${feedback.externalUrl})` : ""
              }`,
          )
        : [];

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
      comments: feedbackComments,
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
      workspacePath: run.workspace?.path,
      summary: run.resultSummary ?? undefined,
      error: run.failureReason ?? undefined,
      attempt: run.attempt,
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

  private async loadDbPromptContext(runId: string) {
    return this.db.run.findUnique({
      where: {
        id: runId,
      },
      include: {
        agentDefinition: true,
        repository: {
          include: {
            project: {
              include: {
                team: true,
              },
            },
          },
        },
        role: true,
      },
    });
  }

  private async loadPromptComponentsForRun(
    context: NonNullable<Awaited<ReturnType<DbControlPlaneStore["loadDbPromptContext"]>>>,
  ) {
    const bindings = await this.db.promptBinding.findMany({
      where: {
        status: "active",
        environment: "dev",
        OR: [
          { scopeType: "team", scopeId: context.repository.project.team.id },
          { scopeType: "project", scopeId: context.repository.project.id },
          { scopeType: "repo", scopeId: context.repository.id },
          { scopeType: "role", scopeId: context.roleId },
          { scopeType: "agent", scopeId: context.agentDefinitionId },
        ],
      },
      include: {
        promptComponent: true,
      },
      orderBy: [{ orderIndex: "asc" }, { updatedAt: "desc" }],
    });
    const globalComponents = await this.db.promptComponent.findMany({
      where: {
        scopeType: "global",
        status: "active",
      },
      orderBy: [{ name: "asc" }, { version: "desc" }],
    });
    const componentById = new Map(
      [...globalComponents, ...bindings.map((binding) => binding.promptComponent)]
        .filter((component) => component.status === "active")
        .map((component) => [component.id, component]),
    );

    return [...componentById.values()].sort((left, right) => {
      const leftScope = promptScopeOrder.indexOf(left.scopeType);
      const rightScope = promptScopeOrder.indexOf(right.scopeType);
      if (leftScope !== rightScope) return leftScope - rightScope;
      return left.name.localeCompare(right.name);
    });
  }
}

export type PlaneTaskSyncResult = {
  fetched: number;
  upserted: number;
  blockedMissingRepo: number;
};

export class PlaneTaskSyncService {
  private lastSyncAttemptAt?: Date;
  private updatedSinceCursor?: string;

  constructor(
    private readonly db: DbClient,
    private readonly plane: PlaneClient,
    private readonly options: {
      projectSlug: string;
      workspaceSlug?: string;
      projectId?: string;
      perPage?: number;
      minIntervalMs?: number;
      now?: () => Date;
    },
  ) {}

  async sync(): Promise<PlaneTaskSyncResult> {
    const now = this.options.now?.() ?? new Date();
    if (this.shouldThrottle(now)) {
      return { fetched: 0, upserted: 0, blockedMissingRepo: 0 };
    }

    this.lastSyncAttemptAt = now;
    const listParams = {
      workspaceSlug: this.options.workspaceSlug,
      projectId: this.options.projectId,
      perPage: this.options.perPage ?? 100,
      ...(this.updatedSinceCursor ? { updatedSince: this.updatedSinceCursor } : {}),
    };
    const labelResolver = await this.loadLabelResolver();
    const payloads = await this.listTaskPages(listParams);

    let upserted = 0;
    let blockedMissingRepo = 0;

    for (const payload of payloads) {
      const normalized = normalizePlaneTask(payload, { labelResolver });
      if (!normalized.repo) {
        blockedMissingRepo += 1;
      }
      await upsertSyncedTask(
        this.db,
        normalizedPlaneTaskToDbInput(normalized, this.options.projectSlug),
      );
      upserted += 1;
    }

    this.updatedSinceCursor = now.toISOString();

    return {
      fetched: payloads.length,
      upserted,
      blockedMissingRepo,
    };
  }

  private async loadLabelResolver(): Promise<PlaneLabelResolver | undefined> {
    if (!this.plane.listLabels) return undefined;

    const labels = await this.plane.listLabels({
      workspaceSlug: this.options.workspaceSlug,
      projectId: this.options.projectId,
    });
    return createPlaneLabelResolver(labels);
  }

  private async listTaskPages(params: ListPlaneTasksParams): Promise<PlaneTaskPayload[]> {
    const payloads: PlaneTaskPayload[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (let page = 0; page < 100; page += 1) {
      const response = await this.plane.listTaskPage({ ...params, cursor });
      payloads.push(...response.results);

      if (!response.nextCursor || seenCursors.has(response.nextCursor)) {
        return payloads;
      }

      seenCursors.add(response.nextCursor);
      cursor = response.nextCursor;
    }

    throw new Error("Plane task sync pagination exceeded 100 pages");
  }

  private shouldThrottle(now: Date): boolean {
    const minIntervalMs = this.options.minIntervalMs ?? 0;
    if (minIntervalMs <= 0 || !this.lastSyncAttemptAt) {
      return false;
    }

    return now.getTime() - this.lastSyncAttemptAt.getTime() < minIntervalMs;
  }

  async syncRunResult(
    task: Task,
    result: OpenHandsRunResult,
    traceRef: TraceRef,
    nextState: TaskState,
  ): Promise<PlaneSyncEvidence> {
    const requestedStateName = workerTaskStateToPlaneStateName(nextState);
    const updatedTask = await this.plane.updateTask(task.planeId, {
      stateName: requestedStateName,
      summary: result.summary,
    });
    const updatedStateName = normalizePlaneTask(updatedTask).stateName ?? requestedStateName;
    const commentBody = [
      "Agent Status: Completed",
      "",
      `Next State: ${requestedStateName}`,
      `Conversation: ${result.conversationId}`,
      `Trace: ${traceRef.url ?? traceRef.traceId}`,
      "",
      result.summary,
    ].join("\n");
    const comment = await this.plane.addComment(task.planeId, commentBody);

    return {
      taskId: task.planeId,
      stateName: updatedStateName,
      commentId: comment.id,
      commentBody: comment.body ?? commentBody,
    };
  }

  async syncRunStatus(task: Task, run: Run, status: "Claimed" | "Running" | "Failed") {
    await this.plane.addComment(
      task.planeId,
      [
        `Agent Status: ${status}`,
        "",
        `Run: ${run.id}`,
        `Role: ${run.role}`,
        `Worker: ${run.workerId ?? "unknown"}`,
        `Current State: ${workerTaskStateToPlaneStateName(task.state)}`,
        status === "Failed" && run.error ? `Error: ${run.error}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
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
      apiKeyHeader: config.planeApiKeyHeader,
      workspaceSlug: config.planeWorkspaceSlug,
      projectId: config.planeProjectId,
    }),
    {
      projectSlug: config.projectSlug,
      workspaceSlug: config.planeWorkspaceSlug,
      projectId: config.planeProjectId,
      perPage: config.planeSyncPerPage,
      minIntervalMs: config.planeSyncMinIntervalMs,
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
    priority: task.priority,
    labels: task.labels,
    assignee: task.assignee,
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
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
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
      workspacePath: input.workspacePath,
      prompt: input.prompt,
      metadata: {
        role: input.run.role,
        state: input.task.state,
        project: input.task.project,
        workspacePath: input.workspacePath ?? "",
      },
    });
    await this.client.startRun(conversation.id);

    let eventCursor: string | undefined;
    const events: OpenHandsRuntimeEvent[] = [];
    for (let attempt = 0; attempt < this.options.pollAttempts; attempt += 1) {
      const page = await this.client.listEvents(conversation.id, eventCursor);
      events.push(...page.events);
      eventCursor = page.nextCursor ?? eventCursor;
      await input.onHeartbeat?.({
        conversationId: conversation.id,
        attempt: attempt + 1,
        eventCursor,
        eventsSeen: events.length,
        newEvents: page.events.length,
      });

      const result = await this.client.getResult(conversation.id);
      if (result) {
        return {
          status: result.status === "completed" ? "succeeded" : "failed",
          conversationId: result.conversationId,
          conversationUrl: conversation.url,
          eventCursor: result.eventCursor ?? eventCursor,
          events,
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
      eventCursor,
      events,
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
    const summary = await this.client.finishTrace(trace.traceId, {
      conversationId: input.conversationId,
    });

    return {
      traceId: trace.traceId,
      url: trace.url,
      inputTokens: summary.usage.inputTokens,
      outputTokens: summary.usage.outputTokens,
      costUsd: summary.cost.totalCostUsd,
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

export async function runDryRun(): Promise<DispatchResult | undefined> {
  const config = loadConfig();
  const worker = createDispatchWorker(config);
  return worker.dispatchOnce();
}

export type WorkerLoopOptions = {
  maxIterations?: number;
  shouldStop?: () => boolean;
};

export async function runWorkerLoop(options: WorkerLoopOptions = {}): Promise<void> {
  const config = loadConfig();
  const worker = createDispatchWorker(config);
  let iterations = 0;

  while (!options.shouldStop?.()) {
    const result = await worker.dispatchOnce();
    if (result) {
      console.log(JSON.stringify(formatLiveDispatchResult(result), null, 2));
    } else {
      console.log("No dispatchable tasks found.");
    }

    iterations += 1;
    if (options.maxIterations && iterations >= options.maxIterations) {
      return;
    }

    await sleep(config.workerLoopIntervalMs);
  }
}

function createDispatchWorker(config: WorkerConfig): DispatchWorker {
  const store =
    config.mode === "live"
      ? new DbControlPlaneStore(prisma, {
          planeSync: createPlaneTaskSyncService(config, prisma),
        })
      : new InMemoryControlPlaneStore();
  return new DispatchWorker(
    config,
    store,
    createOpenHandsAdapter(config),
    createTraceRecorder(config),
  );
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
      endpoints: {
        conversations: config.openHandsConversationsPath,
        runs: config.openHandsRunsPath,
      },
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
      endpoints: {
        traces: config.langfuseTracesPath,
        generations: config.langfuseGenerationsPath,
      },
    }),
  );
}

export function redactRuntimeSecrets(value: string): string {
  return secretRedactors.reduce((current, redactor) => {
    if (typeof redactor.replacement === "string") {
      return current.replace(redactor.pattern, redactor.replacement);
    }
    return current.replace(redactor.pattern, redactor.replacement);
  }, value);
}

const secretRedactors: Array<{
  pattern: RegExp;
  replacement: string | ((substring: string, ...args: string[]) => string);
}> = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    pattern:
      /\b((?:api[_-]?key|secret|token|password|authorization|bearer|access[_-]?key|private[_-]?key)\s*[:=]\s*)(["']?)([^\s"'`]{8,})(\2)/gi,
    replacement: (_match, prefix: string, quote: string, _secret: string, suffix: string) =>
      `${prefix}${quote}[REDACTED_SECRET]${suffix}`,
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replacement: "Bearer [REDACTED_SECRET]",
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    replacement: "[REDACTED_SLACK_TOKEN]",
  },
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED_AWS_ACCESS_KEY]",
  },
];

function toDbTaskState(state: TaskState): DbTaskState {
  const dbState = dbStateByWorkerState[state];
  if (!dbState) {
    throw new Error(`Task state ${state} is not persisted in the DB schema`);
  }
  return dbState;
}

function roleKeyFromRunRole(role: string): AgentRoleKey {
  if (role.includes("Intake")) return "intake";
  if (role.includes("Review")) return "code_review";
  if (role.includes("Merge")) return "merge";
  if (role.includes("Release")) return "release";
  if (role.includes("Deploy")) return "deployment";
  return "development";
}

function unresolvedFeedbackFromTask(task: Task) {
  return task.comments
    .map((comment) => /\[feedback:[^/\]]+\/(?<severity>info|minor|major|blocker)\]/.exec(comment))
    .map((match) => match?.groups?.severity)
    .filter((severity): severity is "info" | "minor" | "major" | "blocker" => {
      return (
        severity === "info" ||
        severity === "minor" ||
        severity === "major" ||
        severity === "blocker"
      );
    })
    .map((severity) => ({ severity }));
}

function isAllowedWorkerTransition(from: TaskState, to: TaskState): boolean {
  return validateTransition(from as never, to as never).ok;
}

function openHandsEventToRunEventInput(event: OpenHandsRuntimeEvent) {
  return {
    externalId: event.id,
    type: event.type,
    message: openHandsEventMessage(event),
    createdAt: event.createdAt,
    payload: openHandsEventPayload(event),
  };
}

function openHandsEventMessage(event: OpenHandsRuntimeEvent): string {
  if (event.type === "agent.message") return event.message.slice(0, 500);
  if (event.type === "tool.call") return `tool.call:${event.toolName}`;
  if (event.type === "tool.result") return `tool.result:${event.toolName}`;
  return `run.status:${event.status}`;
}

function openHandsEventPayload(event: OpenHandsRuntimeEvent): Record<string, unknown> {
  if (event.type === "agent.message") return { message: event.message };
  if (event.type === "tool.call") return { toolName: event.toolName, input: event.input };
  if (event.type === "tool.result") return { toolName: event.toolName, output: event.output };
  return { status: event.status };
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

function planePerPageFromEnv(value: string | undefined, fallback: number): number {
  const parsed = numberFromEnv(value, fallback);
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
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

function estimatedCostFromLabels(labels: string[]): number | undefined {
  for (const label of labels) {
    const match = /^(?:cost|estimated[-_]cost):(?<cost>\d+(?:\.\d+)?)$/i.exec(label.trim());
    if (!match?.groups?.cost) {
      continue;
    }
    const cost = Number(match.groups.cost);
    if (Number.isFinite(cost) && cost >= 0) {
      return cost;
    }
  }

  return undefined;
}

function normalizeStateName(stateName?: string): string {
  return (stateName ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .trim();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  if (process.env.WORKER_RUN_LOOP === "true") {
    await runWorkerLoop();
    return;
  }

  const result = await runDryRun();
  if (!result) {
    console.log("No dispatchable tasks found.");
    return;
  }

  console.log(JSON.stringify(formatLiveDispatchResult(result), null, 2));
}

export function formatLiveDispatchResult(result: DispatchResult) {
  return {
    task: {
      id: result.task.id,
      planeId: result.task.planeId,
      title: result.task.title,
      team: result.task.team,
      project: result.task.project,
      repo: result.task.repo ?? null,
      state: result.task.state,
    },
    run: {
      id: result.run.id,
      status: result.run.status,
      role: result.run.role,
      attempt: result.run.attempt,
      promptReleaseId: result.run.promptReleaseId ?? null,
      workspacePath: result.run.workspacePath ?? null,
      conversationId: result.run.conversationId ?? null,
      conversationUrl: result.run.conversationUrl ?? null,
      langfuseTraceId: result.run.langfuseTraceId ?? null,
      langfuseTraceUrl: result.run.langfuseTraceUrl ?? null,
      nextState: result.run.nextState ?? null,
      summary: result.run.summary ?? null,
      error: result.run.error ?? null,
    },
    verification: {
      runDetailPath: `/runs/${result.run.id}`,
      planeEvidence: result.task.planeId,
      planeStateEvidence: result.planeSync?.stateName ?? null,
      planeCommentEvidence: result.planeSync?.commentId ?? null,
      openHandsEvidence: result.run.conversationUrl ?? result.run.conversationId ?? null,
      langfuseEvidence: result.run.langfuseTraceUrl ?? result.run.langfuseTraceId ?? null,
      expectedNextState: result.run.nextState ?? null,
    },
  };
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
