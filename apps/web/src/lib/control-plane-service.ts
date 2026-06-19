import {
  healthSignals,
  promptReleases,
  queueSummary,
  runs,
  taskQueue,
  type HealthSignal,
  type PromptRelease,
  type Run,
  type TaskQueueItem,
} from "./mock-data";

const checkedAt = new Date("2026-06-18T16:20:00.000Z").toISOString();

export type TaskQueueResponse = {
  count: number;
  summary: typeof queueSummary;
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

export type SystemHealthResponse = {
  service: "agent-control-plane-web";
  status: "ok" | "degraded";
  checkedAt: string;
  queue: typeof queueSummary;
  signals: HealthSignal[];
};

export function getTaskQueue(): TaskQueueResponse {
  return {
    count: taskQueue.length,
    summary: queueSummary,
    tasks: taskQueue,
  };
}

export function getRuns(): RunsResponse {
  return {
    count: runs.length,
    runs,
  };
}

export function getPromptReleases(): PromptReleasesResponse {
  return {
    count: promptReleases.length,
    promptReleases,
  };
}

export function getSystemHealth(): SystemHealthResponse {
  return {
    service: "agent-control-plane-web",
    status: healthSignals.some((signal) => signal.state === "degraded") ? "degraded" : "ok",
    checkedAt,
    queue: queueSummary,
    signals: healthSignals,
  };
}
