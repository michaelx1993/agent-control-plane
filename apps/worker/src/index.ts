import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

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
  langfuseBaseUrl?: string;
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
    langfuseBaseUrl: env.LANGFUSE_BASE_URL,
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
  const store = new InMemoryControlPlaneStore();
  const worker = new DispatchWorker(
    config,
    store,
    new MockOpenHandsAdapter(),
    new MockTraceRecorder(),
  );
  return worker.dispatchOnce();
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
