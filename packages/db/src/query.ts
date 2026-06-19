import type {
  AgentRuntime,
  Prisma,
  PrismaClient,
  RepositoryStatus,
  RunEventType,
  RunStatus,
  Task,
  TaskState,
} from "@prisma/client";
import { createHash } from "node:crypto";

export type DbClient = Pick<
  PrismaClient,
  | "$transaction"
  | "agentDefinition"
  | "conversationRef"
  | "project"
  | "promptBinding"
  | "promptComponent"
  | "promptReleaseComponent"
  | "promptRelease"
  | "repository"
  | "role"
  | "run"
  | "runEvent"
  | "task"
  | "traceRef"
>;

export const dispatchableTaskStates = [
  "Todo",
  "Development",
  "CodeReview",
  "InMerge",
  "ReleaseVersion",
  "Deployment",
] as const satisfies readonly TaskState[];

const activeRunStatuses = ["queued", "claimed", "running"] as const satisfies readonly RunStatus[];

export type DispatchableTaskCandidate = Pick<Task, "repositoryId" | "state"> & {
  repository?: { status: RepositoryStatus } | null;
  runs?: Array<{ status: RunStatus; leaseExpiresAt: Date | null }>;
};

export function isDispatchableTaskCandidate(
  task: DispatchableTaskCandidate,
  now = new Date(),
): boolean {
  if (!task.repositoryId || task.repository?.status !== "active") {
    return false;
  }

  if (!dispatchableTaskStates.includes(task.state as (typeof dispatchableTaskStates)[number])) {
    return false;
  }

  return !task.runs?.some((run) => {
    return (
      activeRunStatuses.includes(run.status as (typeof activeRunStatuses)[number]) &&
      run.leaseExpiresAt !== null &&
      run.leaseExpiresAt > now
    );
  });
}

export interface FindDispatchableTasksOptions {
  limit?: number;
  now?: Date;
}

export async function findDispatchableTasks(
  db: DbClient,
  options: FindDispatchableTasksOptions = {},
) {
  const now = options.now ?? new Date();

  return db.task.findMany({
    where: {
      state: { in: [...dispatchableTaskStates] },
      repositoryId: { not: null },
      repository: { status: "active" },
      runs: {
        none: {
          status: { in: [...activeRunStatuses] },
          leaseExpiresAt: { gt: now },
        },
      },
    },
    include: {
      repository: true,
      project: {
        include: {
          team: true,
        },
      },
    },
    orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { updatedAt: "asc" }],
    take: options.limit,
  });
}

export interface UpsertSyncedTaskInput {
  projectSlug: string;
  externalTaskId: string;
  identifier?: string;
  title: string;
  state: TaskState;
  repositorySlug?: string;
  priority?: number;
  labels?: string[];
  assignee?: string;
  url?: string;
  syncCursor?: string;
}

export async function upsertSyncedTask(db: DbClient, input: UpsertSyncedTaskInput) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: {
        slug: input.projectSlug,
        status: "active",
      },
      select: {
        id: true,
      },
    });

    if (!project) {
      throw new Error(`Project ${input.projectSlug} not found or inactive`);
    }

    const repository = input.repositorySlug
      ? await tx.repository.findFirst({
          where: {
            projectId: project.id,
            slug: input.repositorySlug,
            status: "active",
          },
          select: {
            id: true,
          },
        })
      : null;

    const now = new Date();
    return tx.task.upsert({
      where: {
        projectId_externalTaskId: {
          projectId: project.id,
          externalTaskId: input.externalTaskId,
        },
      },
      update: {
        repositoryId: repository?.id ?? null,
        identifier: input.identifier ?? input.externalTaskId,
        title: input.title,
        state: input.state,
        priority: input.priority,
        labels: input.labels ?? [],
        assignee: input.assignee,
        url: input.url,
        lastSyncedAt: now,
        syncCursor: input.syncCursor,
      },
      create: {
        projectId: project.id,
        repositoryId: repository?.id,
        externalTaskId: input.externalTaskId,
        identifier: input.identifier ?? input.externalTaskId,
        title: input.title,
        state: input.state,
        priority: input.priority,
        labels: input.labels ?? [],
        assignee: input.assignee,
        url: input.url,
        lastSyncedAt: now,
        syncCursor: input.syncCursor,
      },
      include: {
        repository: true,
        project: {
          include: {
            team: true,
          },
        },
      },
    });
  });
}

export interface StartRunInput {
  taskId: string;
  leaseOwner: string;
  leaseSeconds?: number;
  renderedPrompt?: string;
  runtime?: AgentRuntime;
}

export async function startRun(db: DbClient, input: StartRunInput) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseSeconds ?? 15 * 60) * 1000);
  const renderedContent = input.renderedPrompt ?? "";

  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: input.taskId },
      include: {
        repository: true,
      },
    });

    if (!task?.repositoryId || !task.repository) {
      throw new Error(`Task ${input.taskId} is missing an active repository`);
    }

    const role = await tx.role.findFirst({
      where: {
        activeStates: { has: task.state },
      },
      orderBy: { key: "asc" },
    });

    if (!role) {
      throw new Error(`No active role found for task state ${task.state}`);
    }

    const agentDefinition = await tx.agentDefinition.findFirst({
      where: {
        roleId: role.id,
        runtime: input.runtime ?? "openhands",
        status: "active",
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!agentDefinition) {
      throw new Error(`No active agent definition found for role ${role.key}`);
    }

    const promptRelease = await tx.promptRelease.create({
      data: {
        taskId: task.id,
        repositoryId: task.repositoryId,
        roleId: role.id,
        agentDefinitionId: agentDefinition.id,
        contentHash: hashPrompt(renderedContent),
        renderedContent,
      },
    });

    const run = await tx.run.create({
      data: {
        taskId: task.id,
        repositoryId: task.repositoryId,
        roleId: role.id,
        agentDefinitionId: agentDefinition.id,
        promptReleaseId: promptRelease.id,
        status: "claimed",
        leaseOwner: input.leaseOwner,
        leaseExpiresAt,
        heartbeatAt: now,
        startedAt: now,
      },
      include: {
        role: true,
        promptRelease: true,
      },
    });

    await tx.runEvent.create({
      data: {
        runId: run.id,
        eventType: "claimed",
        message: `Run claimed by ${input.leaseOwner}`,
        payload: {
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          promptReleaseId: promptRelease.id,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return run;
  });
}

export interface MarkRunRunningInput {
  runId: string;
  leaseOwner: string;
  renderedPrompt: string;
  leaseSeconds?: number;
  components?: Array<{
    promptComponentId: string;
    orderIndex: number;
    contentHash: string;
  }>;
}

export async function markRunRunning(db: DbClient, input: MarkRunRunningInput) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseSeconds ?? 15 * 60) * 1000);

  return db.$transaction(async (tx) => {
    const existingRun = await tx.run.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        promptReleaseId: true,
      },
    });

    if (!existingRun) {
      throw new Error(`Run ${input.runId} not found`);
    }

    await tx.promptRelease.update({
      where: { id: existingRun.promptReleaseId },
      data: {
        renderedContent: input.renderedPrompt,
        contentHash: hashPrompt(input.renderedPrompt),
      },
    });
    if (input.components !== undefined) {
      await tx.promptReleaseComponent.deleteMany({
        where: {
          promptReleaseId: existingRun.promptReleaseId,
        },
      });
      if (input.components.length > 0) {
        await tx.promptReleaseComponent.createMany({
          data: input.components.map((component) => ({
            promptReleaseId: existingRun.promptReleaseId,
            promptComponentId: component.promptComponentId,
            orderIndex: component.orderIndex,
            contentHash: component.contentHash,
          })),
        });
      }
    }

    const run = await tx.run.update({
      where: {
        id: input.runId,
        leaseOwner: input.leaseOwner,
        status: { in: ["claimed", "running"] },
      },
      data: {
        status: "running",
        heartbeatAt: now,
        leaseExpiresAt,
      },
      include: {
        role: true,
        promptRelease: true,
      },
    });

    await tx.runEvent.create({
      data: {
        runId: run.id,
        eventType: "heartbeat",
        message: "Run marked running",
        payload: {
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          promptReleaseId: run.promptReleaseId,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return run;
  });
}

export interface CreateRunInput {
  taskId: string;
  repositoryId: string;
  roleId: string;
  agentDefinitionId: string;
  promptReleaseId: string;
  leaseOwner?: string;
  leaseSeconds?: number;
  attempt?: number;
}

export async function createRun(db: DbClient, input: CreateRunInput) {
  const now = new Date();
  const leaseExpiresAt = input.leaseOwner
    ? new Date(now.getTime() + (input.leaseSeconds ?? 15 * 60) * 1000)
    : null;
  const status = input.leaseOwner ? "claimed" : "queued";

  return db.$transaction(async (tx) => {
    const run = await tx.run.create({
      data: {
        taskId: input.taskId,
        repositoryId: input.repositoryId,
        roleId: input.roleId,
        agentDefinitionId: input.agentDefinitionId,
        promptReleaseId: input.promptReleaseId,
        status,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt,
        heartbeatAt: input.leaseOwner ? now : null,
        attempt: input.attempt ?? 1,
        startedAt: input.leaseOwner ? now : null,
      },
    });

    await tx.runEvent.create({
      data: {
        runId: run.id,
        eventType: status === "claimed" ? "claimed" : "queued",
        message: status === "claimed" ? `Run claimed by ${input.leaseOwner}` : "Run queued",
        payload: {
          leaseOwner: input.leaseOwner ?? null,
          leaseExpiresAt: leaseExpiresAt?.toISOString() ?? null,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return run;
  });
}

export interface HeartbeatRunInput {
  runId: string;
  leaseOwner: string;
  leaseSeconds?: number;
  message?: string;
}

export async function heartbeatRun(db: DbClient, input: HeartbeatRunInput) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseSeconds ?? 15 * 60) * 1000);

  return db.$transaction(async (tx) => {
    const run = await tx.run.update({
      where: {
        id: input.runId,
        leaseOwner: input.leaseOwner,
        status: { in: ["claimed", "running"] },
      },
      data: {
        status: "running",
        heartbeatAt: now,
        leaseExpiresAt,
      },
    });

    await tx.runEvent.create({
      data: {
        runId: run.id,
        eventType: "heartbeat",
        message: input.message ?? "Run heartbeat",
        payload: {
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        } satisfies Prisma.InputJsonObject,
      },
    });

    return run;
  });
}

export interface MarkExpiredLeasesInput {
  now?: Date;
  limit?: number;
  failureReason?: string;
}

export type MarkExpiredLeasesResult = {
  count: number;
  runIds: string[];
};

export async function markExpiredLeasesFailed(
  db: DbClient,
  input: MarkExpiredLeasesInput = {},
): Promise<MarkExpiredLeasesResult> {
  const now = input.now ?? new Date();
  const failureReason = input.failureReason ?? "Lease expired without heartbeat";

  return db.$transaction(async (tx) => {
    const expiredRuns = await tx.run.findMany({
      where: {
        status: {
          in: ["claimed", "running"],
        },
        leaseExpiresAt: {
          lt: now,
        },
      },
      select: {
        id: true,
        leaseOwner: true,
        leaseExpiresAt: true,
      },
      orderBy: {
        leaseExpiresAt: "asc",
      },
      take: input.limit ?? 100,
    });

    for (const run of expiredRuns) {
      await tx.run.update({
        where: {
          id: run.id,
        },
        data: {
          status: "failed",
          leaseExpiresAt: null,
          finishedAt: now,
          failureReason,
        },
      });

      await tx.runEvent.create({
        data: {
          runId: run.id,
          eventType: "failed",
          message: failureReason,
          payload: {
            leaseOwner: run.leaseOwner,
            expiredAt: run.leaseExpiresAt?.toISOString() ?? null,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    return {
      count: expiredRuns.length,
      runIds: expiredRuns.map((run) => run.id),
    };
  });
}

export interface RecordRunObservabilityRefsInput {
  runId: string;
  conversationId: string;
  conversationUrl?: string;
  eventCursor?: string;
  traceId: string;
  traceUrl?: string;
  model?: string;
  promptReleaseId?: string;
  inputTokens?: bigint | number;
  outputTokens?: bigint | number;
  costUsd?: Prisma.Decimal | Prisma.DecimalJsLike | number | string;
  latencyMs?: number;
}

export async function recordRunObservabilityRefs(
  db: DbClient,
  input: RecordRunObservabilityRefsInput,
) {
  const inputTokens = input.inputTokens === undefined ? undefined : BigInt(input.inputTokens);
  const outputTokens = input.outputTokens === undefined ? undefined : BigInt(input.outputTokens);

  return db.$transaction(async (tx) => {
    const run = await tx.run.findUnique({
      where: {
        id: input.runId,
      },
      select: {
        id: true,
        promptReleaseId: true,
      },
    });

    if (!run) {
      throw new Error(`Run ${input.runId} not found`);
    }

    const promptReleaseId = input.promptReleaseId ?? run.promptReleaseId;

    const conversationRef = await tx.conversationRef.upsert({
      where: {
        runId: input.runId,
      },
      update: {
        conversationId: input.conversationId,
        eventCursor: input.eventCursor,
        uiUrl: input.conversationUrl,
      },
      create: {
        runId: input.runId,
        conversationId: input.conversationId,
        eventCursor: input.eventCursor,
        uiUrl: input.conversationUrl,
      },
    });

    const existingTraceRef = await tx.traceRef.findFirst({
      where: {
        runId: input.runId,
        traceId: input.traceId,
      },
      select: {
        id: true,
      },
    });

    const traceData = {
      promptReleaseId,
      model: input.model,
      inputTokens,
      outputTokens,
      costUsd: input.costUsd,
      latencyMs: input.latencyMs,
      uiUrl: input.traceUrl,
    };
    const traceRef = existingTraceRef
      ? await tx.traceRef.update({
          where: {
            id: existingTraceRef.id,
          },
          data: traceData,
        })
      : await tx.traceRef.create({
          data: {
            runId: input.runId,
            traceId: input.traceId,
            ...traceData,
          },
        });

    await tx.runEvent.create({
      data: {
        runId: input.runId,
        eventType: "state_sync",
        message: "Recorded OpenHands conversation and Langfuse trace refs",
        payload: {
          conversationId: input.conversationId,
          traceId: input.traceId,
          promptReleaseId,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return {
      conversationRef,
      traceRef,
    };
  });
}

export interface RecordRunExternalEventsInput {
  runId: string;
  source: string;
  events: Array<{
    externalId: string;
    type: string;
    message?: string;
    createdAt?: string;
    payload?: unknown;
  }>;
}

export async function recordRunExternalEvents(db: DbClient, input: RecordRunExternalEventsInput) {
  if (input.events.length === 0) {
    return { count: 0 };
  }

  return db.$transaction(async (tx) => {
    for (const event of input.events) {
      await tx.runEvent.create({
        data: {
          runId: input.runId,
          eventType: "state_sync",
          message: event.message ?? `${input.source}:${event.type}`,
          payload: {
            source: input.source,
            externalEventId: event.externalId,
            externalEventType: event.type,
            externalCreatedAt: event.createdAt ?? null,
            event: (event.payload ?? {}) as Prisma.InputJsonValue,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    return { count: input.events.length };
  });
}

export interface CompleteRunInput {
  runId: string;
  leaseOwner?: string;
  status: Extract<RunStatus, "succeeded" | "blocked" | "failed" | "canceled">;
  resultSummary?: string;
  failureReason?: string;
  nextState?: TaskState;
  tokenInput?: bigint | number;
  tokenOutput?: bigint | number;
  costUsd?: Prisma.Decimal | Prisma.DecimalJsLike | number | string;
}

export async function completeRun(db: DbClient, input: CompleteRunInput) {
  const finishedAt = new Date();
  const tokenInput = input.tokenInput === undefined ? undefined : BigInt(input.tokenInput);
  const tokenOutput = input.tokenOutput === undefined ? undefined : BigInt(input.tokenOutput);
  const tokenTotal =
    tokenInput !== undefined || tokenOutput !== undefined
      ? (tokenInput ?? 0n) + (tokenOutput ?? 0n)
      : undefined;

  return db.$transaction(async (tx) => {
    const run = await tx.run.update({
      where: {
        id: input.runId,
        ...(input.leaseOwner ? { leaseOwner: input.leaseOwner } : {}),
      },
      data: {
        status: input.status,
        leaseExpiresAt: null,
        finishedAt,
        resultSummary: input.resultSummary,
        failureReason: input.failureReason,
        nextState: input.nextState,
        tokenInput,
        tokenOutput,
        tokenTotal,
        costUsd: input.costUsd,
      },
    });

    await tx.runEvent.create({
      data: {
        runId: run.id,
        eventType: terminalStatusToEventType(input.status),
        message: input.resultSummary ?? input.failureReason ?? `Run ${input.status}`,
        payload: {
          status: input.status,
          nextState: input.nextState ?? null,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return run;
  });
}

function terminalStatusToEventType(status: CompleteRunInput["status"]): RunEventType {
  switch (status) {
    case "succeeded":
      return "completed";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
  }
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}
