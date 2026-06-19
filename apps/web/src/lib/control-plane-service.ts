import {
  normalizePlaneTask,
  parsePlaneWebhookPayload,
  type PlaneWebhookEventType,
  type ParsedPlaneWebhook,
  type PlaneTaskPayload,
  type NormalizedPlaneTask,
} from "@agent-control-plane/plane";
import {
  evaluateRuntimePolicy,
  type ActiveRun as RuntimePolicyActiveRun,
  type RuntimePolicyDecision,
  type RuntimePolicyConfig,
  type TaskCandidate,
} from "@agent-control-plane/runtime-policy";
import { validateTransition } from "@agent-control-plane/state-machine";
import { upsertSyncedTask, type DbClient } from "../../../../packages/db/src/query";
import {
  auditLog as mockAuditLog,
  healthSignals,
  operatorTimeline as mockOperatorTimeline,
  promptMetrics as mockPromptMetrics,
  promptReleases,
  queueSummary as mockQueueSummary,
  type ReadinessCategory,
  runs,
  runDetails,
  taskQueue,
  type AuditLogItem,
  type HealthSignal,
  type OperatorTimelineItem,
  type MonitoringResponse,
  type PromptRelease,
  type PromptMetricsResponse,
  type Run,
  type RunDetail,
  type RunEvent,
  type RunProgressItem,
  type TaskQueueItem,
} from "./mock-data";
import { PrismaClient } from "@prisma/client";
import type {
  PromptComponent as DbPromptComponent,
  RunStatus as DbRunStatus,
  TaskState as DbTaskState,
} from "@prisma/client";
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

export type TaskQueueFilters = {
  project?: string;
  repo?: string;
  state?: string;
  team?: string;
};

export type AuditLogFilters = {
  action?: string;
  entityType?: string;
};

export type AuditLogResponse = {
  count: number;
  auditLog: AuditLogItem[];
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

export type { PromptMetricsResponse };

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

export type PromptComponentDiffLine = {
  type: "unchanged" | "added" | "removed";
  text: string;
};

export type PromptComponentDiffResponse = {
  left: PromptComponentItem;
  right: PromptComponentItem;
  summary: {
    added: number;
    removed: number;
    unchanged: number;
  };
  lines: PromptComponentDiffLine[];
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

export type RollbackPromptComponentInput = {
  author?: string | null;
  changelog?: string | null;
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

export type ResolveFeedbackInput = {
  reason?: string;
};

export type ReleaseTaskRetryInput = {
  reason?: string;
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

export type OperatorTimelineResponse = {
  count: number;
  timeline: OperatorTimelineItem[];
};

export type { MonitoringResponse };

export type SystemReadinessResponse = {
  status: "ready" | "warning" | "missing";
  checkedAt: string;
  categories: ReadinessCategory[];
};

export type TransitionTaskInput = {
  nextState: TaskQueueItem["state"];
  reason?: string;
};

export type QueueSummary = {
  eligible: number;
  blocked: number;
  retryCapped: number;
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

const roleByDbState: Partial<Record<DbTaskState, string>> = {
  Todo: "Intake",
  Development: "Development Agent",
  CodeReview: "Review Agent",
  InMerge: "Merge Agent",
  ReleaseVersion: "Release Agent",
  Deployment: "Deploy Agent",
};

export async function getTaskQueue(filters: TaskQueueFilters = {}): Promise<TaskQueueResponse> {
  if (shouldUseDatabase()) {
    return getTaskQueueFromDb(filters);
  }

  const filteredTasks = filterTaskQueueItems(taskQueue, filters);
  return {
    count: filteredTasks.length,
    summary: summarizeQueue(filteredTasks, runs),
    tasks: filteredTasks,
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
    if (!isUuid(runId)) {
      return null;
    }
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
    resolvedAt: feedback.resolvedAt?.toISOString(),
  };
}

export async function resolveFeedbackItem(feedbackId: string, input: ResolveFeedbackInput = {}) {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to resolve feedback");
  }

  const feedback = await prisma.feedbackItem.findUnique({
    where: { id: feedbackId },
    select: {
      id: true,
      taskId: true,
      resolvedAt: true,
    },
  });
  if (!feedback) {
    throw new Error(`Feedback ${feedbackId} not found`);
  }

  const resolvedAt = feedback.resolvedAt ?? new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.feedbackItem.update({
      where: { id: feedback.id },
      data: {
        resolvedAt,
      },
    });
    await tx.auditEvent.create({
      data: {
        action: "feedback.resolve",
        entityType: "feedback",
        entityId: item.id,
        message: input.reason ?? "Feedback marked resolved by operator",
        payload: {
          taskId: feedback.taskId,
          previouslyResolved: Boolean(feedback.resolvedAt),
        },
      },
    });
    return item;
  });

  return {
    id: updated.id,
    resolvedAt: updated.resolvedAt?.toISOString() ?? resolvedAt.toISOString(),
  };
}

export async function releaseTaskRetry(identifier: string, input: ReleaseTaskRetryInput = {}) {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to release task retry");
  }

  const task = await prisma.task.findFirst({
    where: { identifier },
    include: {
      runs: {
        select: {
          attempt: true,
        },
        orderBy: {
          attempt: "desc",
        },
        take: 1,
      },
    },
  });
  if (!task) {
    throw new Error(`Task ${identifier} not found`);
  }

  const retryAfterAttempt = Math.max(task.retryAfterAttempt, task.runs[0]?.attempt ?? 0);
  const released = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: task.id },
      data: { retryAfterAttempt },
    });
    await tx.auditEvent.create({
      data: {
        action: "task.retry_released",
        entityType: "task",
        entityId: task.id,
        message: input.reason ?? "Manual retry release",
        payload: {
          identifier: task.identifier,
          retryAfterAttempt,
        },
      },
    });
    return updated;
  });

  return {
    id: released.identifier,
    retryAfterAttempt: released.retryAfterAttempt,
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

export async function getPromptMetrics(): Promise<PromptMetricsResponse> {
  if (!shouldUseDatabase()) {
    return {
      count: mockPromptMetrics.length,
      promptMetrics: mockPromptMetrics,
    };
  }

  const releases = await prisma.promptRelease.findMany({
    include: {
      repository: true,
      role: true,
      runs: {
        include: {
          traceRefs: true,
        },
      },
      components: {
        include: {
          promptComponent: true,
        },
        orderBy: {
          orderIndex: "asc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });
  const promptMetrics = releases.map((release) => {
    const runCount = release.runs.length;
    const succeeded = release.runs.filter((run) => run.status === "succeeded").length;
    const failed = release.runs.filter((run) => run.status === "failed").length;
    const blocked = release.runs.filter((run) => run.status === "blocked").length;
    const tokenInputs = release.runs.map((run) =>
      Number(run.traceRefs[0]?.inputTokens ?? run.tokenInput ?? 0),
    );
    const tokenOutputs = release.runs.map((run) =>
      Number(run.traceRefs[0]?.outputTokens ?? run.tokenOutput ?? 0),
    );
    const costs = release.runs.map((run) => Number(run.traceRefs[0]?.costUsd ?? run.costUsd ?? 0));
    const lastRunAt =
      release.runs
        .map((run) => run.startedAt ?? run.createdAt)
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString() ?? release.createdAt.toISOString();

    return {
      promptReleaseId: release.id,
      scope: [
        release.repository.slug,
        release.role.name,
        ...release.components.map(
          (component) =>
            `${component.promptComponent.scopeType}:${component.promptComponent.name}@v${component.promptComponent.version}`,
        ),
      ].join(" + "),
      version: release.langfusePromptVersion ?? release.createdAt.toISOString(),
      hash: `sha256:${release.contentHash.slice(0, 12)}`,
      runCount,
      successRate: runCount > 0 ? succeeded / runCount : 0,
      succeeded,
      failed,
      blocked,
      avgInputTokens: averageRounded(tokenInputs),
      avgOutputTokens: averageRounded(tokenOutputs),
      avgCostUsd: averageNumber(costs).toFixed(6),
      lastRunAt,
    };
  });

  return {
    count: promptMetrics.length,
    promptMetrics,
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
  const promptComponents = components.map(promptComponentToItem);

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

export async function getPromptComponentDiff(
  leftId: string,
  rightId: string,
): Promise<PromptComponentDiffResponse> {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to diff prompt components");
  }

  const [left, right] = await Promise.all([
    prisma.promptComponent.findUnique({ where: { id: leftId } }),
    prisma.promptComponent.findUnique({ where: { id: rightId } }),
  ]);
  if (!left) {
    throw new Error(`Prompt component ${leftId} not found`);
  }
  if (!right) {
    throw new Error(`Prompt component ${rightId} not found`);
  }

  const lines = diffLines(left.content, right.content);
  return {
    left: promptComponentToItem(left),
    right: promptComponentToItem(right),
    summary: {
      added: lines.filter((line) => line.type === "added").length,
      removed: lines.filter((line) => line.type === "removed").length,
      unchanged: lines.filter((line) => line.type === "unchanged").length,
    },
    lines,
  };
}

export async function rollbackPromptComponent(
  sourceId: string,
  input: RollbackPromptComponentInput = {},
): Promise<PromptComponentItem> {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to rollback prompt components");
  }

  return prisma.$transaction(async (tx) => {
    const source = await tx.promptComponent.findUnique({
      where: { id: sourceId },
    });
    if (!source) {
      throw new Error(`Prompt component ${sourceId} not found`);
    }

    const version = await nextPromptComponentVersionTx(
      tx,
      source.scopeType,
      source.scopeId,
      source.name,
    );
    await tx.promptComponent.updateMany({
      where: {
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        name: source.name,
        status: "active",
      },
      data: {
        status: "archived",
      },
    });
    const rollback = await tx.promptComponent.create({
      data: {
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        name: source.name,
        version,
        status: "active",
        content: source.content,
        changelog:
          input.changelog ?? `Rollback to ${source.name}@v${source.version} from ${source.id}`,
        author: input.author ?? source.author,
      },
    });
    await tx.auditEvent.create({
      data: {
        action: "prompt.rollback",
        entityType: "prompt_component",
        entityId: rollback.id,
        message: `Rolled back ${source.name} to v${source.version}`,
        payload: {
          sourceId: source.id,
          sourceVersion: source.version,
          newVersion: rollback.version,
          scopeType: rollback.scopeType,
          scopeId: rollback.scopeId,
          name: rollback.name,
        },
      },
    });

    return promptComponentToItem(rollback);
  });
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

export async function getOperatorTimeline(): Promise<OperatorTimelineResponse> {
  if (!shouldUseDatabase()) {
    return {
      count: mockOperatorTimeline.length,
      timeline: mockOperatorTimeline,
    };
  }

  const [runEvents, auditEvents, feedbackItems] = await Promise.all([
    prisma.runEvent.findMany({
      include: {
        run: {
          include: {
            task: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.feedbackItem.findMany({
      include: {
        run: true,
        task: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const timeline = [
    ...runEvents.map((event): OperatorTimelineItem => {
      return {
        id: `run-event-${event.id}`,
        source: "run",
        tone: runEventTone(event.eventType),
        title: `${event.run.task.identifier} · ${event.eventType}`,
        detail: event.message ?? event.run.task.title,
        createdAt: event.createdAt.toISOString(),
        href: `/runs/${event.runId}`,
      };
    }),
    ...auditEvents.map((event): OperatorTimelineItem => {
      return {
        id: `audit-${event.id}`,
        source: "audit",
        tone: event.action.includes("retry") ? "attention" : "nominal",
        title: event.action,
        detail: event.message ?? `${event.entityType}:${event.entityId}`,
        createdAt: event.createdAt.toISOString(),
        href: event.entityType === "run" ? `/runs/${event.entityId}` : "/",
      };
    }),
    ...feedbackItems.map((item): OperatorTimelineItem => {
      return {
        id: `feedback-${item.id}`,
        source: "feedback",
        tone: item.severity === "blocker" || item.severity === "major" ? "attention" : "nominal",
        title: `${item.task.identifier} · ${item.source}/${item.severity}`,
        detail: item.body,
        createdAt: item.createdAt.toISOString(),
        href: item.runId ? `/runs/${item.runId}` : "/",
      };
    }),
  ]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 50);

  return {
    count: timeline.length,
    timeline,
  };
}

export async function getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogResponse> {
  if (!shouldUseDatabase()) {
    const auditLog = filterAuditLogItems(mockAuditLog, filters);
    return {
      count: auditLog.length,
      auditLog,
    };
  }

  const auditEvents = await prisma.auditEvent.findMany({
    include: {
      actorUser: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 200,
    where: {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
    },
  });

  const auditLog = auditEvents.map((event): AuditLogItem => {
    return {
      id: event.id,
      action: event.action,
      actor: event.actorUser?.name ?? "operator",
      entityId: event.entityId,
      entityType: event.entityType,
      message: event.message ?? "",
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
      href: hrefForAuditEvent(event.entityType, event.entityId),
    };
  });

  return {
    count: auditLog.length,
    auditLog,
  };
}

export async function getMonitoring(windowHours = 24): Promise<MonitoringResponse> {
  if (!shouldUseDatabase()) {
    return getMockMonitoring(windowHours);
  }

  const now = new Date();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const [queue, dbRuns] = await Promise.all([
    getTaskQueue(),
    prisma.run.findMany({
      where: {
        createdAt: {
          gte: since,
        },
      },
      include: {
        repository: true,
        task: true,
        traceRefs: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 500,
    }),
  ]);
  const runTotal = dbRuns.length;
  const succeeded = dbRuns.filter((run) => run.status === "succeeded").length;
  const failed = dbRuns.filter((run) => run.status === "failed").length;
  const blocked = dbRuns.filter((run) => run.status === "blocked").length;
  const running = dbRuns.filter((run) => activeRunStatuses.has(run.status)).length;
  const inputTokens = sumNumbers(
    dbRuns.map((run) => Number(run.traceRefs[0]?.inputTokens ?? run.tokenInput ?? 0)),
  );
  const outputTokens = sumNumbers(
    dbRuns.map((run) => Number(run.traceRefs[0]?.outputTokens ?? run.tokenOutput ?? 0)),
  );
  const costUsd = sumNumbers(
    dbRuns.map((run) => Number(run.traceRefs[0]?.costUsd ?? run.costUsd ?? 0)),
  );
  const leaseMs = getWorkerLeaseMs();
  const stalledRuns = dbRuns
    .filter((run) => activeRunStatuses.has(run.status))
    .filter((run) => isRunStalled(run.leaseExpiresAt, run.heartbeatAt, now, leaseMs))
    .map((run) => ({
      id: run.id,
      taskId: run.task.identifier,
      repo: run.repository.slug,
      status: dbRunStatusToApiStatus(run.status),
      heartbeat: run.heartbeatAt?.toISOString() ?? "never",
      reason:
        run.leaseExpiresAt && run.leaseExpiresAt < now
          ? "lease expired"
          : `heartbeat stale over ${Math.round(leaseMs / 1000)}s`,
    }));

  return {
    generatedAt: now.toISOString(),
    windowHours,
    queue: {
      total: queue.count,
      eligible: queue.summary.eligible,
      blocked: queue.summary.blocked,
      retryCapped: queue.summary.retryCapped,
      running: queue.summary.running,
      failed: queue.summary.failed,
    },
    runs: {
      total: runTotal,
      succeeded,
      failed,
      blocked,
      running,
      successRate: runTotal > 0 ? succeeded / runTotal : 0,
    },
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: costUsd.toFixed(6),
    },
    stalledRuns,
  };
}

export async function getSystemReadiness(): Promise<SystemReadinessResponse> {
  const controlPlaneChecks: ReadinessCategory["checks"] = [
    envCheck("DATABASE_URL", process.env.DATABASE_URL, "PostgreSQL persistence"),
    envCheck(
      "WORKER_MODE",
      process.env.WORKER_MODE,
      "Worker mode; use live after Plane/OpenHands/Langfuse are configured",
      { warningWhenMissing: "defaults to mock" },
    ),
    envCheck(
      "WORKER_MAX_TASK_ATTEMPTS",
      process.env.WORKER_MAX_TASK_ATTEMPTS,
      "Retry cap per task",
      { warningWhenMissing: "defaults to 3" },
    ),
    envCheck(
      "CONTROL_PLANE_API_TOKEN",
      process.env.CONTROL_PLANE_API_TOKEN,
      "Operator write API token",
      { optional: true },
    ),
    envCheck(
      "CONTROL_PLANE_READ_API_TOKEN",
      process.env.CONTROL_PLANE_READ_API_TOKEN,
      "Optional read API token; falls back to CONTROL_PLANE_API_TOKEN when unset",
      { optional: true },
    ),
  ];
  if (shouldUseDatabase()) {
    controlPlaneChecks.push(await databaseBaselineReadinessCheck());
  }

  const categories: ReadinessCategory[] = [
    {
      id: "plane",
      label: "Plane self-host",
      checks: [
        envCheck("PLANE_BASE_URL", process.env.PLANE_BASE_URL, "Plane API base URL"),
        envCheck("PLANE_WORKSPACE_SLUG", process.env.PLANE_WORKSPACE_SLUG, "Plane workspace"),
        envCheck("PLANE_PROJECT_ID", process.env.PLANE_PROJECT_ID, "Plane project"),
        envCheck("PLANE_API_KEY", process.env.PLANE_API_KEY, "Plane API auth token"),
        envCheck("PLANE_WEBHOOK_SECRET", process.env.PLANE_WEBHOOK_SECRET, "Plane webhook guard", {
          optional: true,
        }),
      ],
    },
    {
      id: "openhands",
      label: "OpenHands runtime",
      checks: [
        envCheck("OPENHANDS_BASE_URL", process.env.OPENHANDS_BASE_URL, "OpenHands SDK/API URL"),
        envCheck("OPENHANDS_API_KEY", process.env.OPENHANDS_API_KEY, "OpenHands auth token", {
          optional: true,
        }),
      ],
    },
    {
      id: "langfuse",
      label: "Langfuse observability",
      checks: [
        envCheck("LANGFUSE_BASE_URL", process.env.LANGFUSE_BASE_URL, "Langfuse API URL"),
        envCheck("LANGFUSE_PUBLIC_KEY", process.env.LANGFUSE_PUBLIC_KEY, "Langfuse public key"),
        envCheck("LANGFUSE_SECRET_KEY", process.env.LANGFUSE_SECRET_KEY, "Langfuse secret key"),
      ],
    },
    {
      id: "control-plane",
      label: "Control Plane",
      checks: controlPlaneChecks,
    },
  ];
  const checks = categories.flatMap((category) => category.checks);
  const status = checks.some((check) => check.status === "missing")
    ? "missing"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "ready";

  return {
    status,
    checkedAt: new Date().toISOString(),
    categories,
  };
}

async function databaseBaselineReadinessCheck(): Promise<ReadinessCategory["checks"][number]> {
  try {
    const [teams, repositories, roles, agents] = await Promise.all([
      prisma.team.count(),
      prisma.repository.count({ where: { status: "active" } }),
      prisma.role.count(),
      prisma.agentDefinition.count({ where: { status: "active" } }),
    ]);
    return databaseBaselineReadinessFromCounts({ teams, repositories, roles, agents });
  } catch (error) {
    return {
      id: "DATABASE_BASELINE",
      label: "Database baseline",
      status: "missing",
      detail: `Unable to verify database baseline: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function databaseBaselineReadinessFromCounts(input: {
  teams: number;
  repositories: number;
  roles: number;
  agents: number;
}): ReadinessCategory["checks"][number] {
  const detail = `Seed baseline: teams=${input.teams}, active repositories=${input.repositories}, roles=${input.roles}, active agents=${input.agents}`;
  if (Object.values(input).some((count) => count <= 0)) {
    return {
      id: "DATABASE_BASELINE",
      label: "Database baseline",
      status: "missing",
      detail: `${detail}. Run database seed before live worker rollout.`,
    };
  }
  return {
    id: "DATABASE_BASELINE",
    label: "Database baseline",
    status: "ready",
    detail,
  };
}

export async function transitionTask(identifier: string, input: TransitionTaskInput) {
  if (!shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required to transition tasks");
  }

  const task = await prisma.task.findFirst({
    where: { identifier },
    include: {
      project: true,
    },
  });
  if (!task) {
    throw new Error(`Task ${identifier} not found`);
  }

  const fromState = dbTaskStateToPlaneState(task.state);
  const transition = validateTransition(fromState, input.nextState);
  if (!transition.ok) {
    throw new Error(transition.error.message);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const transitioned = await tx.task.update({
      where: { id: task.id },
      data: { state: displayPlaneStateToDb(input.nextState) },
    });
    await tx.auditEvent.create({
      data: {
        action: "task.transition",
        entityType: "task",
        entityId: task.id,
        message: input.reason ?? `${fromState} -> ${input.nextState}`,
        payload: {
          identifier,
          fromState,
          nextState: input.nextState,
          project: task.project.slug,
        },
      },
    });
    return transitioned;
  });

  return {
    id: updated.identifier,
    previousState: fromState,
    nextState: dbTaskStateToPlaneState(updated.state),
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
  const state =
    parsed.eventType === "task.deleted" ? "Canceled" : planeStateToDbTaskState(normalized.raw);

  return upsertSyncedTask(prisma as DbClient, {
    projectSlug,
    externalTaskId: normalized.sourceId,
    identifier: normalized.identifier ?? normalized.sourceId,
    title: normalized.title,
    state,
    repositorySlug: normalized.repo,
    priority: normalized.priority,
    labels: normalized.labels,
    assignee: normalized.assignee,
    url: normalized.url,
    syncCursor: parsed.eventType,
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

async function nextPromptComponentVersionTx(
  tx: Pick<typeof prisma, "promptComponent">,
  scopeType: DbPromptScopeType,
  scopeId: string | null,
  name: string,
): Promise<number> {
  const latest = await tx.promptComponent.findFirst({
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

function promptComponentToItem(component: DbPromptComponent): PromptComponentItem {
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

function diffLines(leftContent: string, rightContent: string): PromptComponentDiffLine[] {
  const left = leftContent.split(/\r?\n/);
  const right = rightContent.split(/\r?\n/);
  const table = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? table[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }

  const lines: PromptComponentDiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      lines.push({ type: "unchanged", text: left[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      lines.push({ type: "removed", text: left[leftIndex] });
      leftIndex += 1;
    } else {
      lines.push({ type: "added", text: right[rightIndex] });
      rightIndex += 1;
    }
  }

  while (leftIndex < left.length) {
    lines.push({ type: "removed", text: left[leftIndex] });
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    lines.push({ type: "added", text: right[rightIndex] });
    rightIndex += 1;
  }

  return lines;
}

async function getTaskQueueFromDb(filters: TaskQueueFilters = {}): Promise<TaskQueueResponse> {
  const [tasks, runsResponse, activeRuns] = await Promise.all([
    prisma.task.findMany({
      include: {
        repository: true,
        project: {
          include: {
            team: true,
          },
        },
        runs: {
          select: {
            id: true,
            attempt: true,
            leaseExpiresAt: true,
            status: true,
            updatedAt: true,
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 20,
        },
      },
      orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 100,
    }),
    getRunsFromDb(),
    prisma.run.findMany({
      where: {
        status: {
          in: ["claimed", "running"],
        },
        leaseExpiresAt: {
          gt: new Date(),
        },
      },
      include: {
        repository: true,
        role: true,
      },
    }),
  ]);
  const budgetBlockedTaskIds = new Set(
    (
      await prisma.auditEvent.findMany({
        where: {
          action: "task.budget_blocked",
          entityId: {
            in: tasks.map((task) => task.id),
          },
          entityType: "task",
        },
        orderBy: {
          createdAt: "desc",
        },
        distinct: ["entityId"],
        select: {
          entityId: true,
        },
      })
    ).map((event) => event.entityId),
  );
  const now = new Date();
  const maxAttempts = getWorkerMaxTaskAttempts();
  const policyDecisions = getQueuePolicyDecisions(
    tasks.map((task) => ({
      id: task.id,
      repo: task.repository?.slug,
      state: task.state,
      priority: task.priority,
      createdAt: task.createdAt,
      runs: task.runs,
      retryAfterAttempt: task.retryAfterAttempt ?? 0,
    })),
    activeRuns.map((run) => ({
      taskId: run.taskId,
      repo: run.repository.slug,
      role: run.role.name,
      costSpent: Number(run.costUsd ?? 0),
    })),
    now,
    maxAttempts,
  );
  const responseTasks = tasks.map((task): TaskQueueItem => {
    const activeRun = task.runs.find((run) => activeRunStatuses.has(run.status));
    const hasActiveLease =
      activeRun?.leaseExpiresAt !== null &&
      activeRun?.leaseExpiresAt !== undefined &&
      activeRun.leaseExpiresAt > now &&
      activeRunStatuses.has(activeRun.status);
    const maxAttempt = Math.max(0, ...task.runs.map((run) => run.attempt));
    const retryAfterAttempt = task.retryAfterAttempt ?? 0;
    const displayAttempt = Math.max(0, maxAttempt - retryAfterAttempt);
    const retryCapped = displayAttempt >= maxAttempts;
    const policyDecision = policyDecisions.get(task.id);
    const concurrencyBlocked =
      policyDecision?.reason === "repo-concurrency-exceeded" ||
      policyDecision?.reason === "role-concurrency-exceeded";
    const eligible =
      Boolean(task.repository?.slug) &&
      automaticStates.has(task.state) &&
      task.state !== "Blocked" &&
      !hasActiveLease &&
      !retryCapped &&
      !concurrencyBlocked;
    const budgetBlocked = task.state === "Blocked" && budgetBlockedTaskIds.has(task.id);
    const dispatchStatus = queueDispatchStatus({
      eligible,
      retryCapped,
      budgetBlocked,
      policyDecision,
    });

    return {
      id: task.identifier,
      planeTask: task.title,
      team: task.project.team.key,
      project: task.project.slug,
      repo: task.repository?.slug ?? "",
      state: dbTaskStateToPlaneState(task.state),
      priority: priorityToDisplay(task.priority),
      labels: parseStringArray(task.labels),
      eligible,
      dispatchStatus,
      attempt: displayAttempt,
      maxAttempts,
      lease: queueLeaseDetail({
        activeRunId: activeRun?.id,
        displayAttempt,
        maxAttempts,
        repo: task.repository?.slug,
        role: roleByDbState[task.state],
        retryCapped,
        budgetBlocked,
        policyDecision,
      }),
    };
  });
  const filteredTasks = filterTaskQueueItems(responseTasks, filters);
  const summary = summarizeQueue(filteredTasks, runsResponse.runs);

  return {
    count: filteredTasks.length,
    summary,
    tasks: filteredTasks,
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
      attempt: run.attempt,
      maxAttempts: getWorkerMaxTaskAttempts(),
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
      workspace: true,
    },
  });

  if (!run) {
    return null;
  }

  const trace = run.traceRefs[0];
  const workspace = run.workspace;
  const events = run.runEvents.map((event) => ({
    id: event.id,
    type: event.eventType,
    message: event.message ?? "",
    createdAt: event.createdAt.toISOString(),
    payload: event.payload,
  }));
  const baseRun = runToApiRun({
    id: run.id,
    taskIdentifier: run.task.identifier,
    repositorySlug: run.repository.slug,
    roleName: run.role.name,
    status: run.status,
    promptReleaseId: run.promptReleaseId,
    attempt: run.attempt,
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
    workspacePath: workspace?.path ?? "",
    workspaceStatus: workspace?.status ?? "",
    workspaceStrategy: workspace?.strategy ?? "",
    conversationId: run.conversationRef?.conversationId ?? "",
    eventCursor: run.conversationRef?.eventCursor ?? "",
    traceId: trace?.traceId ?? "",
    tokenInput: Number(trace?.inputTokens ?? run.tokenInput ?? 0),
    tokenOutput: Number(trace?.outputTokens ?? run.tokenOutput ?? 0),
    costUsd: (trace?.costUsd ?? run.costUsd ?? 0).toString(),
    events,
    progress: progressItemsFromEvents(events),
    workpad: workpadFromRunDetail({
      currentState: dbTaskStateToPlaneState(run.task.state),
      failureReason: run.failureReason ?? "",
      nextState: run.nextState ? dbTaskStateToPlaneState(run.nextState) : "",
      openFeedbackCount: run.feedbackItems.filter((item) => !item.resolvedAt).length,
      progressMessage: events.at(-1)?.message ?? "",
      resultSummary: run.resultSummary ?? "",
      workspacePath: workspace?.path ?? "",
    }),
    feedback: run.feedbackItems.map((item) => ({
      id: item.id,
      source: item.source,
      severity: item.severity,
      body: item.body,
      createdAt: item.createdAt.toISOString(),
      externalUrl: item.externalUrl ?? "",
      resolvedAt: item.resolvedAt?.toISOString(),
    })),
  };
}

function progressItemsFromEvents(events: RunEvent[]): RunProgressItem[] {
  return events.map((event) => {
    const externalType = stringFromPayload(event.payload, "externalEventType");
    const phase: RunProgressItem["phase"] =
      externalType !== ""
        ? "openhands"
        : event.type === "claimed"
          ? "claimed"
          : event.type === "heartbeat"
            ? "running"
            : event.type === "completed" ||
                event.type === "failed" ||
                event.type === "blocked" ||
                event.type === "canceled"
              ? "terminal"
              : "state";

    return {
      id: `progress-${event.id}`,
      phase,
      label:
        phase === "openhands"
          ? `OpenHands ${externalType}`
          : event.type === "heartbeat"
            ? "Running"
            : event.type,
      detail: event.message || stringFromPayload(event.payload, "status") || event.type,
      createdAt: event.createdAt,
    };
  });
}

function workpadFromRunDetail(input: {
  currentState: string;
  failureReason: string;
  nextState: string;
  openFeedbackCount: number;
  progressMessage: string;
  resultSummary: string;
  workspacePath: string;
}): string {
  return [
    `Current State: ${input.currentState}`,
    `Suggested Next State: ${input.nextState || "none"}`,
    `Latest Progress: ${input.progressMessage || "none"}`,
    `Open Feedback: ${input.openFeedbackCount}`,
    `Workspace: ${input.workspacePath || "none"}`,
    `Result: ${input.resultSummary || input.failureReason || "pending"}`,
  ].join("\n");
}

function stringFromPayload(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
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
  attempt: number;
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
    attempt: input.attempt,
    maxAttempts: getWorkerMaxTaskAttempts(),
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

function runEventTone(eventType: string): OperatorTimelineItem["tone"] {
  if (eventType === "failed" || eventType === "canceled") return "degraded";
  if (eventType === "blocked") return "attention";
  return "nominal";
}

function envCheck(
  id: string,
  value: string | undefined,
  detail: string,
  options: { optional?: boolean; warningWhenMissing?: string } = {},
): ReadinessCategory["checks"][number] {
  if (value && value.trim().length > 0) {
    return {
      id,
      label: id,
      status: "ready",
      detail,
    };
  }

  if (options.optional || options.warningWhenMissing) {
    return {
      id,
      label: id,
      status: "warning",
      detail: options.warningWhenMissing ?? `${detail} is optional.`,
    };
  }

  return {
    id,
    label: id,
    status: "missing",
    detail,
  };
}

function shouldUseDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getWorkerMaxTaskAttempts(): number {
  const parsed = Number(process.env.WORKER_MAX_TASK_ATTEMPTS ?? "3");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function getWorkerLeaseMs(): number {
  const parsed = Number(process.env.WORKER_LEASE_MS ?? 15 * 60 * 1000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function averageNumber(values: number[]): number {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (validValues.length === 0) return 0;
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function sumNumbers(values: number[]): number {
  return values.filter((value) => Number.isFinite(value)).reduce((sum, value) => sum + value, 0);
}

function averageRounded(values: number[]): number {
  return Math.round(averageNumber(values));
}

function getMockMonitoring(windowHours: number): MonitoringResponse {
  const succeeded = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const blocked = runs.filter((run) => run.status === "blocked").length;
  const running = runs.filter((run) => run.status === "running" || run.status === "claimed").length;
  const total = runs.length;
  const inputTokens = sumNumbers(runs.map((run) => run.tokenInput));
  const outputTokens = sumNumbers(runs.map((run) => run.tokenOutput));
  const stalledRuns = runs
    .filter((run) => run.heartbeat.toLowerCase().includes("stalled"))
    .map((run) => ({
      id: run.id,
      taskId: run.taskId,
      repo: run.repo,
      status: run.status,
      heartbeat: run.heartbeat,
      reason: "heartbeat stalled",
    }));

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    queue: {
      total: taskQueue.length,
      eligible: mockQueueSummary.eligible,
      blocked: mockQueueSummary.blocked,
      retryCapped: mockQueueSummary.retryCapped,
      running: mockQueueSummary.running,
      failed: mockQueueSummary.failed,
    },
    runs: {
      total,
      succeeded,
      failed,
      blocked,
      running,
      successRate: total > 0 ? succeeded / total : 0,
    },
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: sumNumbers(runs.map((run) => Number(run.costUsd))).toFixed(6),
    },
    stalledRuns,
  };
}

function isRunStalled(
  leaseExpiresAt: Date | null,
  heartbeatAt: Date | null,
  now: Date,
  leaseMs: number,
): boolean {
  if (leaseExpiresAt && leaseExpiresAt < now) {
    return true;
  }

  if (!heartbeatAt) {
    return true;
  }

  return now.getTime() - heartbeatAt.getTime() > leaseMs;
}

function getQueuePolicyDecisions(
  tasks: Array<{
    id: string;
    repo?: string;
    state: DbTaskState;
    priority: number | null;
    createdAt: Date;
    retryAfterAttempt: number;
    runs: Array<{
      attempt: number;
      leaseExpiresAt: Date | null;
      status: DbRunStatus;
    }>;
  }>,
  activeRuns: RuntimePolicyActiveRun[],
  now: Date,
  maxAttempts: number,
): Map<string, RuntimePolicyDecision> {
  const candidates: TaskCandidate[] = tasks
    .filter((task) => {
      const activeRun = task.runs.find((run) => activeRunStatuses.has(run.status));
      const hasActiveLease =
        activeRun?.leaseExpiresAt !== null &&
        activeRun?.leaseExpiresAt !== undefined &&
        activeRun.leaseExpiresAt > now &&
        activeRunStatuses.has(activeRun.status);
      const maxAttempt = Math.max(0, ...task.runs.map((run) => run.attempt));
      const displayAttempt = Math.max(0, maxAttempt - task.retryAfterAttempt);
      return (
        Boolean(task.repo) &&
        automaticStates.has(task.state) &&
        task.state !== "Blocked" &&
        !hasActiveLease &&
        displayAttempt < maxAttempts
      );
    })
    .map((task) => ({
      id: task.id,
      repo: task.repo ?? "missing-repo",
      role: roleByDbState[task.state] ?? "Development Agent",
      priority: task.priority ?? undefined,
      createdAt: task.createdAt,
    }));

  const policy = evaluateRuntimePolicy(candidates, activeRuns, queueRuntimePolicyConfig());
  return new Map(policy.dispatch.map((decision) => [decision.task.id, decision]));
}

function queueRuntimePolicyConfig(): RuntimePolicyConfig {
  return {
    defaultRepoConcurrency: numberFromEnv(process.env.WORKER_DEFAULT_REPO_CONCURRENCY, 1),
    defaultRoleConcurrency: numberFromEnv(process.env.WORKER_DEFAULT_ROLE_CONCURRENCY, 2),
  };
}

function queueDispatchStatus(input: {
  eligible: boolean;
  retryCapped: boolean;
  budgetBlocked: boolean;
  policyDecision?: RuntimePolicyDecision;
}): TaskQueueItem["dispatchStatus"] {
  if (input.eligible) return "eligible";
  if (input.retryCapped) return "retry_capped";
  if (input.policyDecision?.reason === "repo-concurrency-exceeded") return "repo_concurrency";
  if (input.policyDecision?.reason === "role-concurrency-exceeded") return "role_concurrency";
  if (input.budgetBlocked) return "budget_blocked";
  return "gated";
}

function queueLeaseDetail(input: {
  activeRunId?: string;
  displayAttempt: number;
  maxAttempts: number;
  repo?: string;
  role?: string;
  retryCapped: boolean;
  budgetBlocked: boolean;
  policyDecision?: RuntimePolicyDecision;
}): string {
  if (input.activeRunId) return `held by ${input.activeRunId}`;
  if (input.retryCapped) return `retry capped at ${input.displayAttempt}/${input.maxAttempts}`;
  if (input.policyDecision?.reason === "repo-concurrency-exceeded") {
    return `waiting for repo concurrency on ${input.repo ?? "unknown repo"}`;
  }
  if (input.policyDecision?.reason === "role-concurrency-exceeded") {
    return `waiting for role concurrency on ${input.role ?? "unknown role"}`;
  }
  if (input.budgetBlocked) return "blocked by cost budget policy";
  if (input.repo) return "available";
  return "blocked: missing repo";
}

function summarizeQueue(tasks: TaskQueueItem[], runsResponse: Run[]): QueueSummary {
  return {
    eligible: tasks.filter((task) => task.eligible).length,
    blocked: tasks.filter((task) => !task.eligible).length,
    retryCapped: tasks.filter((task) => task.dispatchStatus === "retry_capped").length,
    running: runsResponse.filter((run) => run.status === "running").length,
    failed: runsResponse.filter((run) => run.status === "failed").length,
  };
}

function filterTaskQueueItems(tasks: TaskQueueItem[], filters: TaskQueueFilters): TaskQueueItem[] {
  return tasks.filter((task) => {
    return (
      (!filters.team || task.team === filters.team) &&
      (!filters.project || task.project === filters.project) &&
      (!filters.repo || task.repo === filters.repo) &&
      (!filters.state || task.state === filters.state)
    );
  });
}

function filterAuditLogItems(items: AuditLogItem[], filters: AuditLogFilters): AuditLogItem[] {
  return items.filter((item) => {
    return (
      (!filters.action || item.action === filters.action) &&
      (!filters.entityType || item.entityType === filters.entityType)
    );
  });
}

function hrefForAuditEvent(entityType: string, entityId: string): string {
  if (entityType === "run") {
    return `/runs/${entityId}`;
  }
  if (entityType.startsWith("prompt")) {
    return "/prompt-components";
  }
  return "/";
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
    Blocked: "Blocked",
    Canceled: "Canceled",
  };

  return map[state];
}

function displayPlaneStateToDb(state: TaskQueueItem["state"]): DbTaskState {
  const map: Record<TaskQueueItem["state"], DbTaskState> = {
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
