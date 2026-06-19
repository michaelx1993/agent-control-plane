export type RuntimePolicyDecisionStatus = "allowed" | "blocked" | "queued" | "waiting-approval";

export type RuntimePolicyReason =
  | "allowed"
  | "duplicate-active-task"
  | "duplicate-candidate-task"
  | "repo-concurrency-exceeded"
  | "role-concurrency-exceeded"
  | "cost-budget-exceeded";

export interface TaskCandidate {
  id: string;
  repo: string;
  role: string;
  priority?: number;
  estimatedCost?: number;
  createdAt?: string | number | Date;
  metadata?: Record<string, unknown>;
}

export interface ActiveRun {
  taskId: string;
  repo: string;
  role: string;
  estimatedCost?: number;
  costReserved?: number;
  costSpent?: number;
}

export interface CostBudgetPolicy {
  limit: number;
  spent?: number;
  onExceeded?: "waiting-approval" | "blocked";
}

export interface RuntimePolicyConfig {
  defaultRepoConcurrency?: number;
  repoConcurrency?: Record<string, number>;
  defaultRoleConcurrency?: number;
  roleConcurrency?: Record<string, number>;
  costBudget?: CostBudgetPolicy;
}

export interface QueueEntry {
  task: TaskCandidate;
  rank: number;
}

export interface RuntimePolicyDecision {
  task: TaskCandidate;
  status: RuntimePolicyDecisionStatus;
  reason: RuntimePolicyReason;
}

export interface RuntimePolicyResult {
  dispatch: RuntimePolicyDecision[];
  queue: QueueEntry[];
}

interface RankedCandidate {
  task: TaskCandidate;
  originalIndex: number;
}

const DEFAULT_CONCURRENCY = Number.POSITIVE_INFINITY;

export function evaluateRuntimePolicy(
  candidates: TaskCandidate[],
  activeRuns: ActiveRun[],
  config: RuntimePolicyConfig = {},
): RuntimePolicyResult {
  const activeTaskIds = new Set(activeRuns.map((run) => run.taskId));
  const seenCandidateIds = new Set<string>();
  const repoCounts = countBy(activeRuns, (run) => run.repo);
  const roleCounts = countBy(activeRuns, (run) => run.role);
  const ranked = sortCandidates(candidates);
  const dispatch: RuntimePolicyDecision[] = [];
  const queue: QueueEntry[] = [];
  let reservedBudget = getActiveReservedCost(activeRuns);

  for (const [rank, { task }] of ranked.entries()) {
    queue.push({ task, rank });

    if (activeTaskIds.has(task.id)) {
      dispatch.push({ task, status: "blocked", reason: "duplicate-active-task" });
      continue;
    }

    if (seenCandidateIds.has(task.id)) {
      dispatch.push({ task, status: "blocked", reason: "duplicate-candidate-task" });
      continue;
    }

    seenCandidateIds.add(task.id);

    const repoLimit = getConcurrencyLimit(
      task.repo,
      config.repoConcurrency,
      config.defaultRepoConcurrency,
    );
    const currentRepoRuns = repoCounts.get(task.repo) ?? 0;
    if (currentRepoRuns >= repoLimit) {
      dispatch.push({ task, status: "blocked", reason: "repo-concurrency-exceeded" });
      continue;
    }

    const roleLimit = getConcurrencyLimit(
      task.role,
      config.roleConcurrency,
      config.defaultRoleConcurrency,
    );
    const currentRoleRuns = roleCounts.get(task.role) ?? 0;
    if (currentRoleRuns >= roleLimit) {
      dispatch.push({ task, status: "queued", reason: "role-concurrency-exceeded" });
      continue;
    }

    const budgetStatus = evaluateBudget(task, config.costBudget, reservedBudget);
    if (budgetStatus) {
      dispatch.push({ task, status: budgetStatus, reason: "cost-budget-exceeded" });
      continue;
    }

    dispatch.push({ task, status: "allowed", reason: "allowed" });
    repoCounts.set(task.repo, currentRepoRuns + 1);
    roleCounts.set(task.role, currentRoleRuns + 1);
    reservedBudget += getTaskEstimatedCost(task);
  }

  return { dispatch, queue };
}

export function sortRuntimeQueue(candidates: TaskCandidate[]): QueueEntry[] {
  return sortCandidates(candidates).map(({ task }, rank) => ({ task, rank }));
}

function sortCandidates(candidates: TaskCandidate[]): RankedCandidate[] {
  return candidates
    .map((task, originalIndex) => ({ task, originalIndex }))
    .sort((left, right) => {
      const priorityDelta = getPriority(right.task) - getPriority(left.task);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const leftCreated = getCreatedAtTime(left.task);
      const rightCreated = getCreatedAtTime(right.task);
      if (leftCreated !== rightCreated) {
        return leftCreated - rightCreated;
      }

      return left.originalIndex - right.originalIndex;
    });
}

function getPriority(task: TaskCandidate): number {
  return task.priority ?? 0;
}

function getCreatedAtTime(task: TaskCandidate): number {
  if (task.createdAt === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp =
    task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function getConcurrencyLimit(
  key: string,
  overrides: Record<string, number> | undefined,
  fallback: number | undefined,
): number {
  return normalizeLimit(overrides?.[key] ?? fallback ?? DEFAULT_CONCURRENCY);
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_CONCURRENCY;
  }

  return Math.max(0, Math.floor(limit));
}

function evaluateBudget(
  task: TaskCandidate,
  policy: CostBudgetPolicy | undefined,
  reservedBudget: number,
): RuntimePolicyDecisionStatus | undefined {
  if (!policy) {
    return undefined;
  }

  const spent = policy.spent ?? 0;
  const projected = spent + reservedBudget + getTaskEstimatedCost(task);
  if (projected <= policy.limit) {
    return undefined;
  }

  return policy.onExceeded ?? "waiting-approval";
}

function getTaskEstimatedCost(task: TaskCandidate): number {
  return normalizeCost(task.estimatedCost);
}

function getActiveReservedCost(activeRuns: ActiveRun[]): number {
  return activeRuns.reduce(
    (sum, run) => sum + normalizeCost(run.costReserved ?? run.estimatedCost ?? run.costSpent),
    0,
  );
}

function normalizeCost(cost: number | undefined): number {
  if (cost === undefined || !Number.isFinite(cost)) {
    return 0;
  }

  return Math.max(0, cost);
}

function countBy<T>(items: T[], getKey: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}
