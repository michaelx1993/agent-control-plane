import {
  automaticStates,
  manualGateStates,
  roleForState,
  terminalStates,
  type WorkflowState,
} from "@agent-control-plane/core";
import {
  fetchControlPlaneSummary,
  listOperatorRuns,
  listPromptReleases,
  withDatabasePool,
  type ControlPlaneSummary,
  type MonitoringTrendWindow,
  type OperatorRunRecord,
  type PromptReleaseListItem,
} from "@agent-control-plane/db";

export interface DashboardSnapshot {
  status: "ready" | "partial";
  database?: {
    connected: boolean;
    summary?: ControlPlaneSummary;
    error?: string;
  };
  modules: Array<{
    name: string;
    status: "ready" | "pending";
    detail: string;
  }>;
  workflow: Array<{
    state: WorkflowState;
    role: string;
    mode: "agent" | "human" | "terminal";
  }>;
  recentRuns: OperatorRunRecord[];
  recentPromptReleases: PromptReleaseListItem[];
}

export async function getDashboardSnapshot(
  options: {
    trendWindow?: MonitoringTrendWindow;
  } = {},
): Promise<DashboardSnapshot> {
  const database = await getDatabaseStatus(options);
  const operatorData = database.connected
    ? await getOperatorData()
    : { recentRuns: [], recentPromptReleases: [] };
  const automated = automaticStates.map((state) => ({
    state,
    role: roleForState(state),
    mode: "agent" as const,
  }));

  const manual = manualGateStates.map((state) => ({
    state,
    role: roleForState(state),
    mode: "human" as const,
  }));

  const terminal = terminalStates.map((state) => ({
    state,
    role: roleForState(state),
    mode: "terminal" as const,
  }));

  return {
    status: database.connected ? "partial" : "partial",
    database,
    modules: [
      {
        name: "Core",
        status: "ready",
        detail: "状态机、角色路由、repo 路由和 prompt 装配已可复用。",
      },
      {
        name: "Database",
        status: database.connected ? "ready" : "pending",
        detail: database.connected
          ? `PostgreSQL 已连接：tasks=${database.summary?.tasks ?? 0}, repos=${
              database.summary?.repositories ?? 0
            }, activeRuns=${database.summary?.activeRuns ?? 0}。`
          : `PostgreSQL 未连接：${database.error ?? "unknown error"}`,
      },
      {
        name: "Plane",
        status: "ready",
        detail: "self-host、API、repo label 同步和 webhook receiver 已通过本机 smoke。",
      },
      {
        name: "Codex Worker",
        status: "ready",
        detail:
          "默认 execution profile 为 codex-cli；Codex run events、Progress/Workpad、Plane writeback 和 task-source 是主线验收证据。",
      },
      {
        name: "Optional Integrations",
        status: "ready",
        detail:
          "OpenHands adapter 和 Langfuse tracing 仅作为 optional/legacy profile 保留，不阻断 Codex-first 完成门禁。",
      },
    ],
    workflow: [...automated, ...manual, ...terminal],
    recentRuns: operatorData.recentRuns,
    recentPromptReleases: operatorData.recentPromptReleases,
  };
}

async function getDatabaseStatus(options: {
  trendWindow?: MonitoringTrendWindow;
}): Promise<NonNullable<DashboardSnapshot["database"]>> {
  try {
    const summary = await withDatabasePool((pool) => fetchControlPlaneSummary(pool, options));

    return {
      connected: true,
      summary,
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getOperatorData(): Promise<
  Pick<DashboardSnapshot, "recentRuns" | "recentPromptReleases">
> {
  try {
    return await withDatabasePool(async (pool) => {
      const [recentRuns, recentPromptReleases] = await Promise.all([
        listOperatorRuns(pool, { limit: 6 }),
        listPromptReleases(pool, 6),
      ]);

      return {
        recentRuns,
        recentPromptReleases,
      };
    });
  } catch {
    return {
      recentRuns: [],
      recentPromptReleases: [],
    };
  }
}
