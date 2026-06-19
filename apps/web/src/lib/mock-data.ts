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
  | "Blocked"
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
  dispatchStatus:
    | "eligible"
    | "gated"
    | "retry_capped"
    | "budget_blocked"
    | "repo_concurrency"
    | "role_concurrency";
  attempt: number;
  maxAttempts: number;
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
  payload?: unknown;
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

export type PromptMetric = {
  promptReleaseId: string;
  scope: string;
  version: string;
  hash: string;
  runCount: number;
  successRate: number;
  succeeded: number;
  failed: number;
  blocked: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostUsd: string;
  lastRunAt: string;
};

export type PromptMetricsResponse = {
  count: number;
  promptMetrics: PromptMetric[];
};

export type MonitoringResponse = {
  generatedAt: string;
  windowHours: number;
  queue: {
    total: number;
    eligible: number;
    blocked: number;
    retryCapped: number;
    running: number;
    failed: number;
  };
  runs: {
    total: number;
    succeeded: number;
    failed: number;
    blocked: number;
    running: number;
    successRate: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: string;
  };
  stalledRuns: Array<{
    id: string;
    taskId: string;
    repo: string;
    status: RunStatus;
    heartbeat: string;
    reason: string;
  }>;
};

export type HealthSignal = {
  name: string;
  state: "nominal" | "degraded" | "attention";
  value: string;
  detail: string;
};

export type OperatorTimelineItem = {
  id: string;
  source: "run" | "audit" | "feedback";
  tone: "nominal" | "attention" | "degraded";
  title: string;
  detail: string;
  createdAt: string;
  href: string;
};

export type ReadinessCheck = {
  id: string;
  label: string;
  status: "ready" | "missing" | "warning";
  detail: string;
};

export type ReadinessCategory = {
  id: string;
  label: string;
  checks: ReadinessCheck[];
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
    dispatchStatus: "eligible",
    attempt: 0,
    maxAttempts: 3,
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
    dispatchStatus: "eligible",
    attempt: 0,
    maxAttempts: 3,
    lease: "available",
  },
  {
    id: "ACP-1051",
    planeTask: "Review prompt rollback semantics",
    project: "token",
    repo: "sub3",
    state: "Blocked",
    priority: "P1",
    labels: ["repo:sub3", "human-required", "cost:12"],
    eligible: false,
    dispatchStatus: "budget_blocked",
    attempt: 0,
    maxAttempts: 3,
    lease: "blocked by cost budget policy",
  },
  {
    id: "ACP-1057",
    planeTask: "Merge retry policy migration",
    project: "token",
    repo: "crs-src",
    state: "In Merge",
    priority: "P2",
    labels: ["repo:crs-src"],
    eligible: false,
    dispatchStatus: "retry_capped",
    attempt: 3,
    maxAttempts: 3,
    lease: "retry capped at 3/3",
  },
  {
    id: "ACP-1060",
    planeTask: "Tune traffic workspace prompts",
    project: "token",
    repo: "traffic",
    state: "Development",
    priority: "P2",
    labels: ["repo:traffic", "prompt"],
    eligible: false,
    dispatchStatus: "repo_concurrency",
    attempt: 0,
    maxAttempts: 3,
    lease: "waiting for repo concurrency on traffic",
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
      payload: {
        role: run.role,
        attempt: run.attempt,
      },
    },
    {
      id: `${run.id}-running`,
      type: "heartbeat",
      message: "OpenHands conversation started and prompt release injected.",
      createdAt: run.startedAt,
      payload: {
        conversationId: run.openHandsUrl.split("/").at(-1) ?? "",
        promptReleaseId: run.promptReleaseId,
      },
    },
    {
      id: `${run.id}-refs`,
      type: run.status === "failed" ? "failed" : "state_sync",
      message:
        run.status === "failed"
          ? "Run failed after lease expiry; trace link retained for debugging."
          : "Recorded OpenHands conversation and Langfuse trace refs.",
      createdAt: run.heartbeat,
      payload: {
        traceUrl: run.langfuseUrl,
        openHandsUrl: run.openHandsUrl,
      },
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

export const promptMetrics: PromptMetric[] = promptReleases.map((release) => {
  const releaseRuns = runs.filter((run) => run.promptReleaseId === release.id);
  const runCount = releaseRuns.length;
  const succeeded = releaseRuns.filter((run) => run.status === "completed").length;
  const failed = releaseRuns.filter((run) => run.status === "failed").length;
  const blocked = releaseRuns.filter((run) => run.status === "blocked").length;
  const totalInput = releaseRuns.reduce((sum, run) => sum + run.tokenInput, 0);
  const totalOutput = releaseRuns.reduce((sum, run) => sum + run.tokenOutput, 0);
  const totalCost = releaseRuns.reduce((sum, run) => sum + Number(run.costUsd || 0), 0);

  return {
    promptReleaseId: release.id,
    scope: release.scope,
    version: release.version,
    hash: release.hash,
    runCount,
    successRate: runCount > 0 ? succeeded / runCount : 0,
    succeeded,
    failed,
    blocked,
    avgInputTokens: runCount > 0 ? Math.round(totalInput / runCount) : 0,
    avgOutputTokens: runCount > 0 ? Math.round(totalOutput / runCount) : 0,
    avgCostUsd: runCount > 0 ? (totalCost / runCount).toFixed(6) : "0",
    lastRunAt: releaseRuns[0]?.startedAt ?? "",
  };
});

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

export const operatorTimeline: OperatorTimelineItem[] = [
  {
    id: "timeline-run-7741",
    source: "run",
    tone: "nominal",
    title: "Merge Agent running",
    detail: "run-7741 is polling OpenHands and holding the crs-src lease.",
    createdAt: "2026-06-18 09:42",
    href: "/runs/run-7741",
  },
  {
    id: "timeline-run-7736",
    source: "run",
    tone: "nominal",
    title: "Development completed",
    detail: "ACP-1042 advanced to Code Review with OpenHands and Langfuse refs.",
    createdAt: "2026-06-18 08:17",
    href: "/runs/run-7736",
  },
  {
    id: "timeline-feedback-7728",
    source: "feedback",
    tone: "attention",
    title: "Review feedback attached",
    detail: "Retry should resume from the saved event cursor.",
    createdAt: "2026-06-17 18:14",
    href: "/runs/run-7728",
  },
];

export const queueSummary = {
  eligible: taskQueue.filter((task) => task.eligible).length,
  blocked: taskQueue.filter((task) => !task.eligible).length,
  retryCapped: taskQueue.filter((task) => task.dispatchStatus === "retry_capped").length,
  running: runs.filter((run) => run.status === "running").length,
  failed: runs.filter((run) => run.status === "failed").length,
};
