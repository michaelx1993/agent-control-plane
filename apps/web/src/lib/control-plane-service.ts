import {
  normalizePlaneTask,
  parsePlaneWebhookPayload,
  type PlaneWebhookEventType,
  type ParsedPlaneWebhook,
  type PlaneTaskPayload,
  type NormalizedPlaneTask,
} from "@agent-control-plane/plane";
import {
  healthSignals,
  promptReleases,
  queueSummary as mockQueueSummary,
  runs,
  runDetails,
  taskQueue,
  type HealthSignal,
  type PromptRelease,
  type Run,
  type RunDetail,
  type TaskQueueItem,
} from "./mock-data";
import { PrismaClient } from "@prisma/client";
import type { RunStatus as DbRunStatus, TaskState as DbTaskState } from "@prisma/client";
import type {
  FeedbackSeverity as DbFeedbackSeverity,
  FeedbackSource as DbFeedbackSource,
  PromptBindingEnvironment as DbPromptBindingEnvironment,
  PromptBindingStatus as DbPromptBindingStatus,
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

export type RunDetailResponse = {
  run: RunDetail;
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

export type PromptBindingItem = {
  id: string;
  scopeType: DbPromptScopeType;
  scopeId: string;
  promptComponentId: string;
  promptComponentName: string;
  promptComponentVersion: number;
  orderIndex: number;
  environment: DbPromptBindingEnvironment;
  status: DbPromptBindingStatus;
  updatedAt: string;
};

export type PromptBindingsResponse = {
  count: number;
  promptBindings: PromptBindingItem[];
};

export type PromptScopeItem = {
  scopeType: Exclude<DbPromptScopeType, "global">;
  id: string;
  label: string;
  detail: string;
};

export type PromptScopesResponse = {
  count: number;
  scopes: PromptScopeItem[];
};

export type CreateRunFeedbackInput = {
  source?: DbFeedbackSource;
  severity?: DbFeedbackSeverity;
  body: string;
  externalUrl?: string | null;
  returnToDevelopment?: boolean;
};

export type CreatePromptBindingInput = {
  scopeType: DbPromptScopeType;
  scopeId: string;
  promptComponentId: string;
  orderIndex?: number;
  environment?: DbPromptBindingEnvironment;
  status?: DbPromptBindingStatus;
};

export type PlaneWebhookSyncResponse = {
  eventType: PlaneWebhookEventType;
  action: "ignored" | "upserted";
  taskId?: string;
  identifier?: string;
  repositorySlug?: string;
  blockedMissingRepo?: boolean;
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

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  if (shouldUseDatabase()) {
    return getRunDetailFromDb(runId);
  }

  return runDetails.find((run) => run.id === runId) ?? null;
}

export async function createRunFeedback(runId: string, input: CreateRunFeedbackInput) {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to create run feedback");
  }

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      taskId: true,
    },
  });
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const feedback = await prisma.$transaction(async (tx) => {
    const item = await tx.feedbackItem.create({
      data: {
        taskId: run.taskId,
        runId: run.id,
        source: input.source ?? "human",
        severity: input.severity ?? "major",
        body: input.body,
        externalUrl: input.externalUrl ?? null,
      },
    });

    if (input.returnToDevelopment) {
      await tx.task.update({
        where: { id: run.taskId },
        data: { state: "Development" },
      });
      await tx.runEvent.create({
        data: {
          runId: run.id,
          eventType: "state_sync",
          message: "Feedback requested Development rework",
          payload: {
            feedbackId: item.id,
            nextState: "Development",
          },
        },
      });
    }

    return item;
  });

  return {
    id: feedback.id,
    source: feedback.source,
    severity: feedback.severity,
    body: feedback.body,
    createdAt: feedback.createdAt.toISOString(),
    externalUrl: feedback.externalUrl ?? "",
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

export async function getPromptBindings(): Promise<PromptBindingsResponse> {
  if (!shouldUseDatabase()) {
    return {
      count: 0,
      promptBindings: [],
    };
  }

  const bindings = await prisma.promptBinding.findMany({
    include: {
      promptComponent: true,
    },
    orderBy: [{ scopeType: "asc" }, { orderIndex: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });
  const promptBindings = bindings.map((binding): PromptBindingItem => {
    return {
      id: binding.id,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
      promptComponentId: binding.promptComponentId,
      promptComponentName: binding.promptComponent.name,
      promptComponentVersion: binding.promptComponent.version,
      orderIndex: binding.orderIndex,
      environment: binding.environment,
      status: binding.status,
      updatedAt: binding.updatedAt.toISOString(),
    };
  });

  return {
    count: promptBindings.length,
    promptBindings,
  };
}

export async function createPromptBinding(
  input: CreatePromptBindingInput,
): Promise<PromptBindingItem> {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to create prompt bindings");
  }

  if (input.scopeType === "global") {
    throw new Error("Global prompt components are active by status and do not need bindings");
  }

  const binding = await prisma.promptBinding.create({
    data: {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      promptComponentId: input.promptComponentId,
      orderIndex: input.orderIndex ?? 0,
      environment: input.environment ?? "dev",
      status: input.status ?? "active",
    },
    include: {
      promptComponent: true,
    },
  });

  return {
    id: binding.id,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
    promptComponentId: binding.promptComponentId,
    promptComponentName: binding.promptComponent.name,
    promptComponentVersion: binding.promptComponent.version,
    orderIndex: binding.orderIndex,
    environment: binding.environment,
    status: binding.status,
    updatedAt: binding.updatedAt.toISOString(),
  };
}

export async function getPromptScopes(): Promise<PromptScopesResponse> {
  if (!shouldUseDatabase()) {
    return {
      count: 0,
      scopes: [],
    };
  }

  const [teams, projects, repositories, roles, agents] = await Promise.all([
    prisma.team.findMany({
      orderBy: { name: "asc" },
      take: 100,
    }),
    prisma.project.findMany({
      include: { team: true },
      orderBy: [{ slug: "asc" }],
      take: 100,
    }),
    prisma.repository.findMany({
      include: {
        project: true,
      },
      orderBy: [{ slug: "asc" }],
      take: 200,
    }),
    prisma.role.findMany({
      orderBy: { key: "asc" },
      take: 100,
    }),
    prisma.agentDefinition.findMany({
      include: { role: true },
      orderBy: [{ name: "asc" }],
      take: 100,
    }),
  ]);

  const scopes: PromptScopeItem[] = [
    ...teams.map((team) => ({
      scopeType: "team" as const,
      id: team.id,
      label: `${team.name} (${team.key})`,
      detail: team.description ?? team.externalTeamId,
    })),
    ...projects.map((project) => ({
      scopeType: "project" as const,
      id: project.id,
      label: `${project.slug} (${project.name})`,
      detail: `team:${project.team.key}`,
    })),
    ...repositories.map((repository) => ({
      scopeType: "repo" as const,
      id: repository.id,
      label: repository.slug,
      detail: `${repository.project.slug} · ${repository.gitUrl}`,
    })),
    ...roles.map((role) => ({
      scopeType: "role" as const,
      id: role.id,
      label: `${role.key} (${role.name})`,
      detail: role.description ?? role.activeStates.join(", "),
    })),
    ...agents.map((agent) => ({
      scopeType: "agent" as const,
      id: agent.id,
      label: agent.name,
      detail: `${agent.role.name} · ${agent.model} · ${agent.reasoningEffort}`,
    })),
  ];

  return {
    count: scopes.length,
    scopes,
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

export async function syncPlaneWebhookPayload(payload: unknown): Promise<PlaneWebhookSyncResponse> {
  const parsed = parsePlaneWebhookPayload(payload);
  if (!parsed.task || parsed.eventType === "unknown") {
    return {
      eventType: parsed.eventType,
      action: "ignored",
    };
  }

  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to sync Plane webhooks");
  }

  const normalized = normalizePlaneTask(parsed.task);
  const task = await upsertPlaneWebhookTask(parsed, normalized);

  return {
    eventType: parsed.eventType,
    action: "upserted",
    taskId: task.id,
    identifier: task.identifier,
    repositorySlug: normalized.repo,
    blockedMissingRepo: !normalized.repo,
  };
}

async function upsertPlaneWebhookTask(parsed: ParsedPlaneWebhook, normalized: NormalizedPlaneTask) {
  const projectSlug = process.env.CONTROL_PLANE_PROJECT_SLUG ?? "token";
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      status: "active",
    },
    select: {
      id: true,
    },
  });
  if (!project) {
    throw new Error(`Project ${projectSlug} not found or inactive`);
  }

  const repository = normalized.repo
    ? await prisma.repository.findFirst({
        where: {
          projectId: project.id,
          slug: normalized.repo,
          status: "active",
        },
        select: {
          id: true,
        },
      })
    : null;
  const now = new Date();
  const state =
    parsed.eventType === "task.deleted" ? "Canceled" : planeStateToDbTaskState(normalized.raw);

  return prisma.task.upsert({
    where: {
      projectId_externalTaskId: {
        projectId: project.id,
        externalTaskId: normalized.sourceId,
      },
    },
    update: {
      repositoryId: repository?.id ?? null,
      identifier: normalized.identifier ?? normalized.sourceId,
      title: normalized.title,
      state,
      labels: normalized.labels,
      url: normalized.url,
      lastSyncedAt: now,
      syncCursor: parsed.eventType,
    },
    create: {
      projectId: project.id,
      repositoryId: repository?.id,
      externalTaskId: normalized.sourceId,
      identifier: normalized.identifier ?? normalized.sourceId,
      title: normalized.title,
      state,
      labels: normalized.labels,
      url: normalized.url,
      lastSyncedAt: now,
      syncCursor: parsed.eventType,
    },
  });
}

function planeStateToDbTaskState(task: PlaneTaskPayload): DbTaskState {
  const stateName = typeof task.state === "string" ? task.state : task.state?.name;
  const normalized = (stateName ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  const stateMap: Record<string, DbTaskState> = {
    todo: "Todo",
    backlog: "Todo",
    development: "Development",
    started: "Development",
    inprogress: "Development",
    codereview: "CodeReview",
    review: "CodeReview",
    humanreview: "HumanReview",
    inmerge: "InMerge",
    merged: "Merged",
    releaseversion: "ReleaseVersion",
    released: "Released",
    deployment: "Deployment",
    deployed: "Deployed",
    done: "Done",
    completed: "Done",
    blocked: "Blocked",
    canceled: "Canceled",
    cancelled: "Canceled",
  };

  return stateMap[normalized] ?? "Todo";
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
      tokenInput: Number(trace?.inputTokens ?? run.tokenInput ?? 0),
      tokenOutput: Number(trace?.outputTokens ?? run.tokenOutput ?? 0),
      costUsd: (trace?.costUsd ?? run.costUsd ?? 0).toString(),
    };
  });

  return {
    count: responseRuns.length,
    runs: responseRuns,
  };
}

async function getRunDetailFromDb(runId: string): Promise<RunDetail | null> {
  const run = await prisma.run.findUnique({
    where: {
      id: runId,
    },
    include: {
      agentDefinition: true,
      conversationRef: true,
      feedbackItems: {
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
      },
      promptRelease: true,
      repository: {
        include: {
          project: true,
        },
      },
      role: true,
      runEvents: {
        orderBy: {
          createdAt: "asc",
        },
        take: 100,
      },
      task: true,
      traceRefs: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
  });

  if (!run) {
    return null;
  }

  const trace = run.traceRefs[0];
  const baseRun = runToApiRun({
    id: run.id,
    taskIdentifier: run.task.identifier,
    repositorySlug: run.repository.slug,
    roleName: run.role.name,
    status: run.status,
    promptReleaseId: run.promptReleaseId,
    startedAt: run.startedAt,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    heartbeatAt: run.heartbeatAt,
    conversationId: run.conversationRef?.conversationId,
    conversationUrl: run.conversationRef?.uiUrl,
    traceId: trace?.traceId,
    traceUrl: trace?.uiUrl,
  });

  return {
    ...baseRun,
    taskTitle: run.task.title,
    project: run.repository.project.slug,
    planeTaskUrl: run.task.url ?? "",
    agent: run.agentDefinition.name,
    model: run.agentDefinition.model,
    reasoningEffort: run.agentDefinition.reasoningEffort,
    resultSummary: run.resultSummary ?? "",
    failureReason: run.failureReason ?? "",
    nextState: run.nextState ? dbTaskStateToPlaneState(run.nextState) : "",
    promptHash: `sha256:${run.promptRelease.contentHash.slice(0, 12)}`,
    promptPreview: run.promptRelease.renderedContent,
    conversationId: run.conversationRef?.conversationId ?? "",
    eventCursor: run.conversationRef?.eventCursor ?? "",
    traceId: trace?.traceId ?? "",
    tokenInput: Number(trace?.inputTokens ?? run.tokenInput ?? 0),
    tokenOutput: Number(trace?.outputTokens ?? run.tokenOutput ?? 0),
    costUsd: (trace?.costUsd ?? run.costUsd ?? 0).toString(),
    events: run.runEvents.map((event) => ({
      id: event.id,
      type: event.eventType,
      message: event.message ?? "",
      createdAt: event.createdAt.toISOString(),
    })),
    feedback: run.feedbackItems.map((item) => ({
      id: item.id,
      source: item.source,
      severity: item.severity,
      body: item.body,
      createdAt: item.createdAt.toISOString(),
      externalUrl: item.externalUrl ?? "",
    })),
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

function runToApiRun(input: {
  id: string;
  taskIdentifier: string;
  repositorySlug: string;
  roleName: string;
  status: DbRunStatus;
  promptReleaseId: string;
  startedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  conversationId?: string;
  conversationUrl?: string | null;
  traceId?: string;
  traceUrl?: string | null;
}): Run {
  return {
    id: input.id,
    taskId: input.taskIdentifier,
    repo: input.repositorySlug,
    role: normalizeRoleName(input.roleName),
    status: dbRunStatusToApiStatus(input.status),
    promptReleaseId: input.promptReleaseId,
    startedAt: (input.startedAt ?? input.createdAt).toISOString(),
    heartbeat: input.finishedAt
      ? "completed"
      : input.heartbeatAt
        ? `${Math.max(0, Math.round((Date.now() - input.heartbeatAt.getTime()) / 1000))}s ago`
        : "none",
    openHandsUrl:
      input.conversationUrl ??
      (input.conversationId ? `openhands://conversations/${input.conversationId}` : ""),
    langfuseUrl: input.traceUrl ?? (input.traceId ? `langfuse://traces/${input.traceId}` : ""),
    tokenInput: 0,
    tokenOutput: 0,
    costUsd: "0",
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
