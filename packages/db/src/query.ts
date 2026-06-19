import type {
  Prisma,
  PrismaClient,
  RepositoryStatus,
  RunEventType,
  RunStatus,
  Task,
  TaskState,
} from "@prisma/client";

export type DbClient = Pick<PrismaClient, "$transaction" | "task" | "run" | "runEvent">;

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
      project: true,
    },
    orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { updatedAt: "asc" }],
    take: options.limit,
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
