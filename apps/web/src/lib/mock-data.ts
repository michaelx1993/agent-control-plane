export type PlaneState =
  | "Todo"
  | "Development"
  | "Code Review"
  | "Human Review"
  | "In Merge"
  | "Deployment";

export type RunStatus = "queued" | "claimed" | "running" | "blocked" | "completed" | "failed";

export type TaskQueueItem = {
  id: string;
  planeTask: string;
  project: string;
  repo: "crs-src" | "sub3" | "traffic";
  state: PlaneState;
  priority: "P0" | "P1" | "P2";
  labels: string[];
  eligible: boolean;
  lease: string;
};

export type Run = {
  id: string;
  taskId: string;
  repo: TaskQueueItem["repo"];
  role: "Intake" | "Development" | "Code Review" | "Merge";
  status: RunStatus;
  promptReleaseId: string;
  startedAt: string;
  heartbeat: string;
  openHandsUrl: string;
  langfuseUrl: string;
};

export type PromptRelease = {
  id: string;
  scope: string;
  version: string;
  status: "active" | "draft" | "archived";
  hash: string;
  updatedBy: string;
  changelog: string;
};

export type HealthSignal = {
  name: string;
  state: "nominal" | "degraded" | "attention";
  value: string;
  detail: string;
};

export const taskQueue: TaskQueueItem[] = [
  {
    id: "ACP-1042",
    planeTask: "Implement repo-aware dispatch loop",
    project: "token",
    repo: "crs-src",
    state: "Development",
    priority: "P0",
    labels: ["repo:crs-src", "agent-ready"],
    eligible: true,
    lease: "available",
  },
  {
    id: "ACP-1045",
    planeTask: "Backfill Plane webhook receiver coverage",
    project: "token",
    repo: "traffic",
    state: "Todo",
    priority: "P1",
    labels: ["repo:traffic", "webhook"],
    eligible: true,
    lease: "available",
  },
  {
    id: "ACP-1051",
    planeTask: "Review prompt rollback semantics",
    project: "token",
    repo: "sub3",
    state: "Human Review",
    priority: "P1",
    labels: ["repo:sub3", "human-required"],
    eligible: false,
    lease: "blocked by human gate",
  },
  {
    id: "ACP-1057",
    planeTask: "Merge retry policy migration",
    project: "token",
    repo: "crs-src",
    state: "In Merge",
    priority: "P2",
    labels: ["repo:crs-src"],
    eligible: true,
    lease: "held by run-7741",
  },
];

export const runs: Run[] = [
  {
    id: "run-7741",
    taskId: "ACP-1057",
    repo: "crs-src",
    role: "Merge",
    status: "running",
    promptReleaseId: "prm-2026.06.18-4",
    startedAt: "2026-06-18 09:42",
    heartbeat: "24s ago",
    openHandsUrl: "https://openhands.local/conversations/conv-7741",
    langfuseUrl: "https://langfuse.local/project/acp/traces/trace-7741",
  },
  {
    id: "run-7736",
    taskId: "ACP-1042",
    repo: "crs-src",
    role: "Development",
    status: "completed",
    promptReleaseId: "prm-2026.06.18-3",
    startedAt: "2026-06-18 08:17",
    heartbeat: "completed",
    openHandsUrl: "https://openhands.local/conversations/conv-7736",
    langfuseUrl: "https://langfuse.local/project/acp/traces/trace-7736",
  },
  {
    id: "run-7728",
    taskId: "ACP-1038",
    repo: "traffic",
    role: "Code Review",
    status: "failed",
    promptReleaseId: "prm-2026.06.17-9",
    startedAt: "2026-06-17 18:03",
    heartbeat: "stalled after 11m",
    openHandsUrl: "https://openhands.local/conversations/conv-7728",
    langfuseUrl: "https://langfuse.local/project/acp/traces/trace-7728",
  },
];

export const promptReleases: PromptRelease[] = [
  {
    id: "prm-2026.06.18-4",
    scope: "global + token + crs-src + Merge",
    version: "v18",
    status: "active",
    hash: "sha256:9f14c2",
    updatedBy: "operator",
    changelog: "Require PR status and merge gate summary before Plane transition.",
  },
  {
    id: "prm-2026.06.18-3",
    scope: "global + token + crs-src + Development",
    version: "v17",
    status: "active",
    hash: "sha256:7bd01a",
    updatedBy: "owner",
    changelog: "Add repo routing constraints and workpad final summary format.",
  },
  {
    id: "prm-2026.06.17-9",
    scope: "global + token + traffic + Code Review",
    version: "v14",
    status: "archived",
    hash: "sha256:31e6aa",
    updatedBy: "operator",
    changelog: "Archived after retry loop regression.",
  },
];

export const healthSignals: HealthSignal[] = [
  {
    name: "Plane sync",
    state: "nominal",
    value: "18s lag",
    detail: "Polling fallback idle; webhook receiver last event ACP-1057.",
  },
  {
    name: "Lease manager",
    state: "attention",
    value: "1 held",
    detail: "run-7741 owns ACP-1057; expires in 06:31 without heartbeat.",
  },
  {
    name: "OpenHands adapter",
    state: "nominal",
    value: "3 conversations",
    detail: "Latest cursor conv-7741/event/128.",
  },
  {
    name: "Langfuse traces",
    state: "degraded",
    value: "1 failed",
    detail: "trace-7728 ended without final cost event.",
  },
];

export const queueSummary = {
  eligible: taskQueue.filter((task) => task.eligible).length,
  blocked: taskQueue.filter((task) => !task.eligible).length,
  running: runs.filter((run) => run.status === "running").length,
  failed: runs.filter((run) => run.status === "failed").length,
};
