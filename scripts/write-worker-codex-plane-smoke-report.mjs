#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [
  reportFile,
  workerJson,
  databaseEvidenceRaw,
  executionAdapter,
  controlPlaneBaseUrl,
  agentWorkerRepoPath,
  workspaceStrategy,
  workspaceRoot,
  codexModel,
  codexReasoningEffort,
  followUpRequired,
  overwrite,
] = process.argv.slice(2);

if (!reportFile) {
  throw new Error("report_file_required");
}
if (existsSync(reportFile) && overwrite !== "true") {
  throw new Error("report_file_exists");
}

const workerResult = JSON.parse(workerJson);
const claimed = workerResult.claimed?.[0] ?? {};
const completed = workerResult.completed?.[0] ?? {};

function parseKeyValueLines(raw) {
  const values = {};
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const match = /^([^=\s]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    values[key] = value;
  }
  return values;
}

function numberOrNull(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const db = parseKeyValueLines(databaseEvidenceRaw);
const report = {
  reportVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "passed",
  smoke: "worker:codex-plane-smoke",
  executionAdapter,
  controlPlaneBaseUrl,
  agentWorkerRepoPath,
  worker: {
    workerId: workerResult.workerId ?? null,
  },
  run: {
    runId: completed.runId ?? claimed.runId ?? null,
    taskId: completed.taskId ?? claimed.taskId ?? null,
    identifier: claimed.identifier ?? db.task_identifier ?? null,
    role: claimed.role ?? db.role ?? null,
    repositorySlug: claimed.repositorySlug ?? db.repository_slug ?? null,
    nextState: completed.nextState ?? db.run_next_state ?? null,
  },
  codex: {
    model: codexModel,
    reasoningEffort: codexReasoningEffort,
    followUpRequired: followUpRequired === "true",
  },
  workspace: {
    strategy: workspaceStrategy,
    root: workspaceRoot,
  },
  evidence: {
    database: Object.keys(db).length
      ? {
          taskIdentifier: db.task_identifier ?? null,
          taskState: db.task_state ?? null,
          taskUrl: db.task_url ?? null,
          repositorySlug: db.repository_slug ?? null,
          role: db.role ?? null,
          runStatus: db.run_status ?? null,
          runNextState: db.run_next_state ?? null,
          codexEvents: numberOrNull(db.codex_events),
          runningProgress: numberOrNull(db.running_progress),
          eventProgress: numberOrNull(db.event_progress),
          completedProgress: numberOrNull(db.completed_progress),
          threadReuseEvents: numberOrNull(db.thread_reuse_events),
          appServerConversations: numberOrNull(db.app_server_conversations),
        }
      : null,
    checks: {
      claimedRuns: Array.isArray(workerResult.claimed) ? workerResult.claimed.length : 0,
      completedRuns: Array.isArray(workerResult.completed) ? workerResult.completed.length : 0,
      failedRuns: Array.isArray(workerResult.failed) ? workerResult.failed.length : 0,
    },
  },
};

mkdirSync(dirname(reportFile), { recursive: true });
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
chmodSync(reportFile, 0o600);
