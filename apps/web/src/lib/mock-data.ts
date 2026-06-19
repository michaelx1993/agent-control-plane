export type PlaneState =
  | "Todo"
  | "Development"
  | "Code Review"
  | "Human Review"
  | "In Merge"
  | "Merged"
  | "Release Version"
  | "Released"
  | "Deployment"
  | "Deployed"
  | "Done"
  | "Canceled";

export type RunStatus = "queued" | "claimed" | "running" | "blocked" | "completed" | "failed";

export type TaskQueueItem = {
  id: string;
  planeTask: string;
  project: string;
  repo: string;
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
  attempt: number;
  maxAttempts: number;
  promptReleaseId: string;
  startedAt: string;
  heartbeat: string;
  openHandsUrl: string;
  langfuseUrl: string;
  tokenInput: number;
  tokenOutput: number;
  costUsd: string;
};

export type RunEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

export type FeedbackItem = {
  id: string;
  source: string;
  severity: string;
  body: string;
  createdAt: string;
  externalUrl: string;
};

export type RunDetail = Run & {
  taskTitle: string;
  project: string;
  planeTaskUrl: string;
  agent: string;
  model: string;
  reasoningEffort: string;
  resultSummary: string;
  failureReason: string;
  nextState: PlaneState | "";
  promptHash: string;
  promptPreview: string;
  conversationId: string;
  eventCursor: string;
  traceId: string;
  tokenInput: number;
  tokenOutput: number;
  costUsd: string;
  events: RunEvent[];
  feedback: FeedbackItem[];
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
    attempt: 1,
    maxAttempts: 3,
    promptReleaseId: "prm-2026.06.18-4",
    startedAt: "2026-06-18 09:42",
    heartbeat: "24s ago",
    openHandsUrl: "https://openhands.local/conversations/conv-7741",
    langfuseUrl: "https://langfuse.local/project/acp/traces/trace-7741",
    tokenInput: 20980,
    tokenOutput: 4820,
    costUsd: "1.02",
  },
  {
    id: "run-7736",
    taskId: "ACP-1042",
    repo: "crs-src",
    role: "Development",
    status: "completed",
    attempt: 1,
    maxAttempts: 3,
    promptReleaseId: "prm-2026.06.18-3",
    startedAt: "2026-06-18 08:17",
    heartbeat: "completed",
    openHandsUrl: "https://openhands.local/conversations/conv-7736",
    langfuseUrl: "https://langfuse.local/project/acp/traces/trace-7736",
    tokenInput: 18612,
    tokenOutput: 5319,
    costUsd: "0.87",
  },
  {
    id: "run-7728",
    taskId: "ACP-1038",
    repo: "traffic",
    role: "Code Review",
    status: "failed",
    attempt: 3,
    maxAttempts: 3,
    promptReleaseId: "prm-2026.06.17-9",
    startedAt: "2026-06-17 18:03",
    heartbeat: "stalled after 11m",
    openHandsUrl: "https://openhands.local/conversations/conv-7728",
    langfuseUrl: "https://langfuse.local/project/acp/traces/trace-7728",
    tokenInput: 12840,
    tokenOutput: 2048,
    costUsd: "0.42",
  },
];

export const runDetails: RunDetail[] = runs.map((run) => ({
  ...run,
  taskTitle:
    run.taskId === "ACP-1057"
      ? "Merge retry policy migration"
      : run.taskId === "ACP-1042"
        ? "Implement repo-aware dispatch loop"
        : "Stabilize trace finalization",
  project: "token",
  planeTaskUrl: `https://plane.local/acp/${run.taskId}`,
  agent: `${run.role} Agent`,
  model: "gpt-5.5 medium",
  reasoningEffort: "medium",
  resultSummary:
    run.status === "failed"
      ? "Run stalled before final trace close."
      : "Run completed its assigned workflow step and wrote observability refs.",
  failureReason:
    run.status === "failed" ? "Heartbeat expired after OpenHands event stream idle." : "",
  nextState:
    run.role === "Development" ? "Code Review" : run.role === "Merge" ? "Merged" : "Development",
  promptHash: "sha256:7bd01a93",
  promptPreview:
    "global + team + project + repo + role prompt assembled with task context, active comments, workpad, and runtime constraints.",
  conversationId: run.openHandsUrl.split("/").at(-1) ?? "",
  eventCursor: run.id === "run-7728" ? "event-91" : "event-128",
  traceId: run.langfuseUrl.split("/").at(-1) ?? "",
  events: [
    {
      id: `${run.id}-claimed`,
      type: "claimed",
      message: `${run.role} Agent claimed the task lease.`,
      createdAt: run.startedAt,
    },
    {
      id: `${run.id}-running`,
      type: "heartbeat",
      message: "OpenHands conversation started and prompt release injected.",
      createdAt: run.startedAt,
    },
    {
      id: `${run.id}-refs`,
      type: run.status === "failed" ? "failed" : "state_sync",
      message:
        run.status === "failed"
          ? "Run failed after lease expiry; trace link retained for debugging."
          : "Recorded OpenHands conversation and Langfuse trace refs.",
      createdAt: run.heartbeat,
    },
  ],
  feedback:
    run.status === "failed"
      ? [
          {
            id: `${run.id}-fb-1`,
            source: "agent",
            severity: "major",
            body: "Retry should resume from the saved event cursor instead of starting a new conversation.",
            createdAt: run.heartbeat,
            externalUrl: run.openHandsUrl,
          },
        ]
      : [],
}));

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
