import {
  healthSignals,
  promptReleases,
  queueSummary as mockQueueSummary,
  runs,
  taskQueue,
  type HealthSignal,
  type PromptRelease,
  type Run,
  type TaskQueueItem,
} from "./mock-data";
import { PrismaClient } from "@prisma/client";
import type { RunStatus as DbRunStatus, TaskState as DbTaskState } from "@prisma/client";
import type {
  PromptComponentStatus as DbPromptComponentStatus,
  PromptScopeType as DbPromptScopeType,
} from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  webPrisma?: PrismaClient;
};

const prisma = globalForPrisma.webPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.webPrisma = prisma;
}

export type TaskQueueResponse = {
  count: number;
  summary: QueueSummary;
  tasks: TaskQueueItem[];
};

export type RunsResponse = {
  count: number;
  runs: Run[];
};

export type PromptReleasesResponse = {
  count: number;
  promptReleases: PromptRelease[];
};

export type PromptComponentItem = {
  id: string;
  scopeType: DbPromptScopeType;
  scopeId: string | null;
  name: string;
  version: number;
  status: DbPromptComponentStatus;
  content: string;
  changelog: string | null;
  author: string | null;
  updatedAt: string;
};

export type PromptComponentsResponse = {
  count: number;
  promptComponents: PromptComponentItem[];
};

export type CreatePromptComponentInput = {
  scopeType: DbPromptScopeType;
  scopeId?: string | null;
  name: string;
  content: string;
  status?: DbPromptComponentStatus;
  changelog?: string | null;
  author?: string | null;
  version?: number;
};

export type SystemHealthResponse = {
  service: "agent-control-plane-web";
  status: "ok" | "degraded";
  checkedAt: string;
  queue: QueueSummary;
  signals: HealthSignal[];
};

export type QueueSummary = {
  eligible: number;
  blocked: number;
  running: number;
  failed: number;
};

const automaticStates = new Set<DbTaskState>([
  "Todo",
  "Development",
  "CodeReview",
  "InMerge",
  "ReleaseVersion",
  "Deployment",
]);

const activeRunStatuses = new Set<DbRunStatus>(["claimed", "running"]);

export async function getTaskQueue(): Promise<TaskQueueResponse> {
  if (shouldUseDatabase()) {
    return getTaskQueueFromDb();
  }

  return {
    count: taskQueue.length,
    summary: mockQueueSummary,
    tasks: taskQueue,
  };
}

export async function getRuns(): Promise<RunsResponse> {
  if (shouldUseDatabase()) {
    return getRunsFromDb();
  }

  return {
    count: runs.length,
    runs,
  };
}

export async function getPromptReleases(): Promise<PromptReleasesResponse> {
  if (shouldUseDatabase()) {
    return getPromptReleasesFromDb();
  }

  return {
    count: promptReleases.length,
    promptReleases,
  };
}

export async function getPromptComponents(): Promise<PromptComponentsResponse> {
  if (!shouldUseDatabase()) {
    return {
      count: 0,
      promptComponents: [],
    };
  }

  const components = await prisma.promptComponent.findMany({
    orderBy: [{ scopeType: "asc" }, { name: "asc" }, { version: "desc" }],
    take: 200,
  });
  const promptComponents = components.map((component): PromptComponentItem => {
    return {
      id: component.id,
      scopeType: component.scopeType,
      scopeId: component.scopeId,
      name: component.name,
      version: component.version,
      status: component.status,
      content: component.content,
      changelog: component.changelog,
      author: component.author,
      updatedAt: component.updatedAt.toISOString(),
    };
  });

  return {
    count: promptComponents.length,
    promptComponents,
  };
}

export async function createPromptComponent(
  input: CreatePromptComponentInput,
): Promise<PromptComponentItem> {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to create prompt components");
  }

  const version =
    input.version ??
    (await nextPromptComponentVersion(input.scopeType, input.scopeId ?? null, input.name));
  const component = await prisma.promptComponent.create({
    data: {
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      name: input.name,
      version,
      status: input.status ?? "draft",
      content: input.content,
      changelog: input.changelog,
      author: input.author,
    },
  });

  return {
    id: component.id,
    scopeType: component.scopeType,
    scopeId: component.scopeId,
    name: component.name,
    version: component.version,
    status: component.status,
    content: component.content,
    changelog: component.changelog,
    author: component.author,
    updatedAt: component.updatedAt.toISOString(),
  };
}

export async function getSystemHealth(): Promise<SystemHealthResponse> {
  const taskQueueResponse = await getTaskQueue();

  if (shouldUseDatabase()) {
    const dbSignals: HealthSignal[] = [
      {
        name: "Database",
        state: "nominal",
        value: `${taskQueueResponse.count} tasks`,
        detail: "Control Plane API is reading from PostgreSQL.",
      },
      {
        name: "Lease manager",
        state: taskQueueResponse.summary.failed > 0 ? "attention" : "nominal",
        value: `${taskQueueResponse.summary.running} running`,
        detail: `${taskQueueResponse.summary.eligible} eligible, ${taskQueueResponse.summary.blocked} blocked.`,
      },
    ];

    return {
      service: "agent-control-plane-web",
      status: dbSignals.some((signal) => signal.state === "degraded") ? "degraded" : "ok",
      checkedAt: new Date().toISOString(),
      queue: taskQueueResponse.summary,
      signals: dbSignals,
    };
  }

  return {
    service: "agent-control-plane-web",
    status: healthSignals.some((signal) => signal.state === "degraded") ? "degraded" : "ok",
    checkedAt: new Date().toISOString(),
    queue: taskQueueResponse.summary,
    signals: healthSignals,
  };
}

async function nextPromptComponentVersion(
  scopeType: DbPromptScopeType,
  scopeId: string | null,
  name: string,
): Promise<number> {
  const latest = await prisma.promptComponent.findFirst({
    where: {
      scopeType,
      scopeId,
      name,
    },
    orderBy: {
      version: "desc",
    },
    select: {
      version: true,
    },
  });

  return (latest?.version ?? 0) + 1;
}

async function getTaskQueueFromDb(): Promise<TaskQueueResponse> {
  const [tasks, runsResponse] = await Promise.all([
    prisma.task.findMany({
      include: {
        repository: true,
        project: true,
        runs: {
          where: {
            status: {
              in: ["claimed", "running"],
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 100,
    }),
    getRunsFromDb(),
  ]);
  const now = new Date();
  const responseTasks = tasks.map((task): TaskQueueItem => {
    const activeRun = task.runs[0];
    const hasActiveLease =
      activeRun?.leaseExpiresAt !== null &&
      activeRun?.leaseExpiresAt !== undefined &&
      activeRun.leaseExpiresAt > now &&
      activeRunStatuses.has(activeRun.status);
    const eligible =
      Boolean(task.repository?.slug) &&
      automaticStates.has(task.state) &&
      task.state !== "Blocked" &&
      !hasActiveLease;

    return {
      id: task.identifier,
      planeTask: task.title,
      project: task.project.slug,
      repo: task.repository?.slug ?? "",
      state: dbTaskStateToPlaneState(task.state),
      priority: priorityToDisplay(task.priority),
      labels: parseStringArray(task.labels),
      eligible,
      lease: activeRun
        ? `held by ${activeRun.id}`
        : task.repository?.slug
          ? "available"
          : "blocked: missing repo",
    };
  });
  const summary = summarizeQueue(responseTasks, runsResponse.runs);

  return {
    count: responseTasks.length,
    summary,
    tasks: responseTasks,
  };
}

async function getRunsFromDb(): Promise<RunsResponse> {
  const dbRuns = await prisma.run.findMany({
    include: {
      role: true,
      task: true,
      repository: true,
      conversationRef: true,
      traceRefs: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 100,
  });

  const responseRuns = dbRuns.map((run): Run => {
    const trace = run.traceRefs[0];

    return {
      id: run.id,
      taskId: run.task.identifier,
      repo: run.repository.slug,
      role: normalizeRoleName(run.role.name),
      status: dbRunStatusToApiStatus(run.status),
      promptReleaseId: run.promptReleaseId,
      startedAt: run.startedAt?.toISOString() ?? run.createdAt.toISOString(),
      heartbeat: run.finishedAt
        ? "completed"
        : run.heartbeatAt
          ? `${Math.max(0, Math.round((Date.now() - run.heartbeatAt.getTime()) / 1000))}s ago`
          : "none",
      openHandsUrl:
        run.conversationRef?.uiUrl ??
        (run.conversationRef?.conversationId
          ? `openhands://conversations/${run.conversationRef.conversationId}`
          : ""),
      langfuseUrl: trace?.uiUrl ?? (trace?.traceId ? `langfuse://traces/${trace.traceId}` : ""),
    };
  });

  return {
    count: responseRuns.length,
    runs: responseRuns,
  };
}

async function getPromptReleasesFromDb(): Promise<PromptReleasesResponse> {
  const dbPromptReleases = await prisma.promptRelease.findMany({
    include: {
      repository: true,
      role: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  const responsePromptReleases = dbPromptReleases.map((release): PromptRelease => {
    return {
      id: release.id,
      scope: `${release.repository.slug} + ${release.role.name}`,
      version: release.langfusePromptVersion ?? "local",
      status: "active",
      hash: `sha256:${release.contentHash.slice(0, 8)}`,
      updatedBy: "agent-control-plane",
      changelog: `Rendered prompt release for ${release.role.name}.`,
    };
  });

  return {
    count: responsePromptReleases.length,
    promptReleases: responsePromptReleases,
  };
}

function shouldUseDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function summarizeQueue(tasks: TaskQueueItem[], runsResponse: Run[]): QueueSummary {
  return {
    eligible: tasks.filter((task) => task.eligible).length,
    blocked: tasks.filter((task) => !task.eligible).length,
    running: runsResponse.filter((run) => run.status === "running").length,
    failed: runsResponse.filter((run) => run.status === "failed").length,
  };
}

function dbTaskStateToPlaneState(state: DbTaskState): TaskQueueItem["state"] {
  const map: Record<DbTaskState, TaskQueueItem["state"]> = {
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

  return map[state];
}

function dbRunStatusToApiStatus(status: DbRunStatus): Run["status"] {
  if (status === "succeeded") return "completed";
  if (status === "canceled") return "failed";
  return status;
}

function normalizeRoleName(role: string): Run["role"] {
  if (role.includes("Review")) return "Code Review";
  if (role.includes("Merge")) return "Merge";
  if (role.includes("Intake")) return "Intake";
  return "Development";
}

function priorityToDisplay(priority: number | null): TaskQueueItem["priority"] {
  if (priority === 0) return "P0";
  if (priority === 1) return "P1";
  return "P2";
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
