import { runDispatchCycle } from "@agent-control-plane/core";
import {
  claimRuns,
  createPromptReleaseForRun,
  fetchDispatchInputSnapshot,
  findLatestConversationRefForTask,
  getDispatchPolicy,
  markStalledRuns,
  withDatabasePool,
  withTransaction,
} from "@agent-control-plane/db";
import type { RunClaimRecord } from "@agent-control-plane/db";

export interface WorkerClaimInput {
  workerId: string;
  leaseTtlMs?: number;
  maxRuns?: number;
  retryBackoffMs?: number;
  stalledAfterMs?: number;
  repositoryConcurrencyLimit?: number;
  roleConcurrencyLimit?: number;
  agentConcurrencyLimit?: number;
  maxEstimatedCostUsdPerRun?: number;
  executionAdapter?: string;
}

export interface WorkerClaimedRun {
  run: RunClaimRecord;
  promptRelease: {
    id: string;
    contentHash: string;
    renderedContent: string;
  };
  previousConversation?: {
    provider: string;
    conversationId: string;
    eventLogUri?: string;
    uiUrl?: string;
  };
}

export interface WorkerClaimResult {
  claimed: WorkerClaimedRun[];
  skipped: Array<{
    taskId: string;
    identifier: string;
    reasons: string[];
  }>;
  stalled: number;
}

const defaultLeaseTtlMs = 10 * 60 * 1000;
const defaultRetryBackoffMs = 60 * 1000;
const defaultStalledAfterMs = 15 * 60 * 1000;
const defaultMaxRuns = 1;

export async function claimWorkerRuns(input: WorkerClaimInput): Promise<WorkerClaimResult> {
  return withDatabasePool((pool) =>
    withTransaction(pool, async (client) => {
      const now = new Date();
      const leaseTtlMs = input.leaseTtlMs ?? defaultLeaseTtlMs;
      const maxRuns = Math.max(1, Math.trunc(input.maxRuns ?? defaultMaxRuns));
      const stalled = await markStalledRuns(client, {
        heartbeatStaleBefore: new Date(
          now.getTime() - (input.stalledAfterMs ?? defaultStalledAfterMs),
        ),
        leaseExpiredBefore: now,
      });
      const dispatchPolicy = await getDispatchPolicy(client);
      const snapshot = await fetchDispatchInputSnapshot(client, {
        retryBackoffMs: input.retryBackoffMs ?? defaultRetryBackoffMs,
        queuePriorityPolicy: dispatchPolicy.queuePriorityPolicy,
      });
      const cycle = runDispatchCycle({
        ...snapshot,
        tasks: snapshot.tasks.slice(0, maxRuns),
        workerId: input.workerId,
        leaseTtlMs,
        concurrencyPolicy: {
          ...(input.repositoryConcurrencyLimit
            ? { maxActiveRunsPerRepository: input.repositoryConcurrencyLimit }
            : {}),
          ...(input.roleConcurrencyLimit
            ? { maxActiveRunsPerRole: input.roleConcurrencyLimit }
            : {}),
          ...(input.agentConcurrencyLimit
            ? { maxActiveRunsPerAgent: input.agentConcurrencyLimit }
            : {}),
        },
        budgetPolicy: resolveBudgetPolicy(input, dispatchPolicy),
        now,
      });
      const claimed = await claimRuns(client, cycle.claimed.slice(0, maxRuns));
      const hydrated = [];

      for (const run of claimed) {
        const promptRelease = await createPromptReleaseForRun(client, run.runId);
        const previousConversation = await findLatestConversationRefForTask(client, {
          taskId: run.taskId,
          beforeRunId: run.runId,
          ...(input.executionAdapter ? { provider: input.executionAdapter } : {}),
        });
        hydrated.push({
          run,
          promptRelease: {
            id: promptRelease.id,
            contentHash: promptRelease.contentHash,
            renderedContent: promptRelease.renderedContent,
          },
          ...(previousConversation
            ? {
                previousConversation: {
                  provider: previousConversation.provider,
                  conversationId: previousConversation.conversationId,
                  ...(previousConversation.eventLogUri
                    ? { eventLogUri: previousConversation.eventLogUri }
                    : {}),
                  ...(previousConversation.uiUrl ? { uiUrl: previousConversation.uiUrl } : {}),
                },
              }
            : {}),
        });
      }

      return {
        claimed: hydrated,
        skipped: cycle.skipped.map((item) => ({
          taskId: item.task.id,
          identifier: item.task.identifier,
          reasons: item.decision.reasons,
        })),
        stalled: stalled.length,
      };
    }),
  );
}

function resolveBudgetPolicy(
  input: WorkerClaimInput,
  dispatchPolicy: { maxEstimatedCostUsdPerRun?: number },
) {
  const maxEstimatedCostUsdPerRun =
    input.maxEstimatedCostUsdPerRun ?? dispatchPolicy.maxEstimatedCostUsdPerRun;
  return maxEstimatedCostUsdPerRun !== undefined ? { maxEstimatedCostUsdPerRun } : {};
}
