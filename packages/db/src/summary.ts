import type { DatabaseClient } from "./client.js";
import { getMonitoringThresholds, type MonitoringThresholds } from "./monitoring-settings.js";

export interface ControlPlaneSummary {
  teams: number;
  projects: number;
  repositories: number;
  tasks: number;
  activeTasks: number;
  agentQueueLength: number;
  humanGateTasks: number;
  blockedTasks: number;
  activeRuns: number;
  stalledRuns: number;
  retryBacklog: number;
  failedRuns24h: number;
  succeededRuns24h: number;
  finishedRuns24h: number;
  runSuccessRate24h: number;
  tokenTotal: number;
  costUsd: number;
  monitoringThresholds: MonitoringThresholds;
  alertLevel: MonitoringAlertLevel;
  alerts: MonitoringAlert[];
  runTrendWindow: MonitoringTrendWindow;
  runTrend: MonitoringTrendPoint[];
  runTrend24h: MonitoringTrendPoint[];
  promptComponents: number;
  promptBindings: number;
}

export type MonitoringAlertLevel = "ok" | "warning" | "critical";
export type MonitoringTrendWindow = "12h" | "24h" | "7d";

export interface MonitoringAlert {
  key: string;
  level: Exclude<MonitoringAlertLevel, "ok">;
  title: string;
  detail: string;
}

export interface MonitoringTrendPoint {
  hour: string;
  succeededRuns: number;
  failedRuns: number;
  stalledRuns: number;
  tokenTotal: number;
  costUsd: number;
}

interface SummaryRow {
  teams: string;
  projects: string;
  repositories: string;
  tasks: string;
  activeTasks: string;
  agentQueueLength: string;
  humanGateTasks: string;
  blockedTasks: string;
  activeRuns: string;
  stalledRuns: string;
  retryBacklog: string;
  failedRuns24h: string;
  succeededRuns24h: string;
  finishedRuns24h: string;
  tokenTotal: string;
  costUsd: string;
  promptComponents: string;
  promptBindings: string;
}

interface TrendRow {
  hour: string;
  succeeded_runs: string;
  failed_runs: string;
  stalled_runs: string;
  token_total: string;
  cost_usd: string;
}

interface ControlPlaneSummaryOptions {
  trendWindow?: MonitoringTrendWindow;
}

export async function fetchControlPlaneSummary(
  client: DatabaseClient,
  options: ControlPlaneSummaryOptions = {},
): Promise<ControlPlaneSummary> {
  const thresholds = await getMonitoringThresholds(client);
  const trendWindow = options.trendWindow ?? "24h";
  const trendQuery = buildTrendQuery(trendWindow);
  const summaryResult = await client.query<SummaryRow>(
    `
    select
      (select count(*) from teams)::text as teams,
      (select count(*) from projects)::text as projects,
      (select count(*) from repositories)::text as repositories,
      (select count(*) from tasks)::text as tasks,
      (select count(*) from tasks where state::text not in ('Done', 'Canceled', 'Duplicate'))::text as "activeTasks",
      (
        select count(*)
        from tasks
        where state::text in ('Todo', 'Development', 'Code Review', 'In Merge', 'Release Version', 'Deployment')
      )::text as "agentQueueLength",
      (
        select count(*)
        from tasks
        where state::text in ('Human Review', 'Merged', 'Released', 'Deployed')
      )::text as "humanGateTasks",
      (select count(*) from tasks where state::text = 'Blocked')::text as "blockedTasks",
      (select count(*) from runs where status::text in ('queued', 'claimed', 'running'))::text as "activeRuns",
      (select count(*) from runs where status::text = 'stalled')::text as "stalledRuns",
      (
        select count(*)
        from runs
        left join lateral (
          select payload
          from run_events
          where run_events.run_id = runs.id
            and run_events.event_type = 'failed'
          order by run_events.created_at desc
          limit 1
        ) failed_event on true
        where runs.status::text in ('failed', 'stalled')
          and runs.finished_at is not null
          and runs.finished_at + ($1::integer * interval '1 millisecond') > now()
          and (
            runs.status::text = 'stalled'
            or coalesce((failed_event.payload->>'retryable')::boolean, true) = true
          )
      )::text as "retryBacklog",
      (
        select count(*)
        from runs
        where status::text = 'failed'
          and finished_at > now() - interval '24 hours'
      )::text as "failedRuns24h",
      (
        select count(*)
        from runs
        where status::text = 'succeeded'
          and finished_at > now() - interval '24 hours'
      )::text as "succeededRuns24h",
      (
        select count(*)
        from runs
        where status::text in ('succeeded', 'failed', 'stalled')
          and finished_at > now() - interval '24 hours'
      )::text as "finishedRuns24h",
      coalesce((select sum(token_total) from runs), 0)::text as "tokenTotal",
      coalesce((select sum(cost_usd) from runs), 0)::text as "costUsd",
      (select count(*) from prompt_components)::text as "promptComponents",
      (select count(*) from prompt_bindings)::text as "promptBindings"
  `,
    [thresholds.retryBackoffMs],
  );
  const trendResult = await client.query<TrendRow>(trendQuery);

  const row = summaryResult.rows[0];
  if (!row) {
    throw new Error("Database summary query returned no rows");
  }

  const runTrend = trendResult.rows.map(mapTrendPoint);
  const succeededRuns24h = Number.parseInt(row.succeededRuns24h, 10);
  const finishedRuns24h = Number.parseInt(row.finishedRuns24h, 10);
  const summary = {
    teams: Number.parseInt(row.teams, 10),
    projects: Number.parseInt(row.projects, 10),
    repositories: Number.parseInt(row.repositories, 10),
    tasks: Number.parseInt(row.tasks, 10),
    activeTasks: Number.parseInt(row.activeTasks, 10),
    agentQueueLength: Number.parseInt(row.agentQueueLength, 10),
    humanGateTasks: Number.parseInt(row.humanGateTasks, 10),
    blockedTasks: Number.parseInt(row.blockedTasks, 10),
    activeRuns: Number.parseInt(row.activeRuns, 10),
    stalledRuns: Number.parseInt(row.stalledRuns, 10),
    retryBacklog: Number.parseInt(row.retryBacklog, 10),
    failedRuns24h: Number.parseInt(row.failedRuns24h, 10),
    succeededRuns24h,
    finishedRuns24h,
    runSuccessRate24h: successRate(succeededRuns24h, finishedRuns24h),
    tokenTotal: Number.parseInt(row.tokenTotal, 10),
    costUsd: Number.parseFloat(row.costUsd),
    monitoringThresholds: thresholds,
    runTrendWindow: trendWindow,
    runTrend,
    runTrend24h: trendWindow === "24h" ? runTrend : [],
    promptComponents: Number.parseInt(row.promptComponents, 10),
    promptBindings: Number.parseInt(row.promptBindings, 10),
  };
  const alerts = buildMonitoringAlerts(summary, thresholds);

  return {
    ...summary,
    alertLevel: highestAlertLevel(alerts),
    alerts,
  };
}

function buildTrendQuery(window: MonitoringTrendWindow): string {
  if (window === "7d") {
    return `
      with buckets as (
        select generate_series(
          date_trunc('day', now()) - interval '6 days',
          date_trunc('day', now()),
          interval '1 day'
        ) as hour
      )
      select
        buckets.hour::text as hour,
        count(runs.id) filter (where runs.status::text = 'succeeded')::text as succeeded_runs,
        count(runs.id) filter (where runs.status::text = 'failed')::text as failed_runs,
        count(runs.id) filter (where runs.status::text = 'stalled')::text as stalled_runs,
        coalesce(sum(runs.token_total), 0)::text as token_total,
        coalesce(sum(runs.cost_usd), 0)::text as cost_usd
      from buckets
      left join runs
        on runs.finished_at >= buckets.hour
        and runs.finished_at < buckets.hour + interval '1 day'
        and runs.status::text in ('succeeded', 'failed', 'stalled')
      group by buckets.hour
      order by buckets.hour asc
    `;
  }

  const hours = window === "12h" ? 11 : 23;

  return `
      with buckets as (
        select generate_series(
          date_trunc('hour', now()) - interval '${hours} hours',
          date_trunc('hour', now()),
          interval '1 hour'
        ) as hour
      )
      select
        buckets.hour::text as hour,
        count(runs.id) filter (where runs.status::text = 'succeeded')::text as succeeded_runs,
        count(runs.id) filter (where runs.status::text = 'failed')::text as failed_runs,
        count(runs.id) filter (where runs.status::text = 'stalled')::text as stalled_runs,
        coalesce(sum(runs.token_total), 0)::text as token_total,
        coalesce(sum(runs.cost_usd), 0)::text as cost_usd
      from buckets
      left join runs
        on runs.finished_at >= buckets.hour
        and runs.finished_at < buckets.hour + interval '1 hour'
        and runs.status::text in ('succeeded', 'failed', 'stalled')
      group by buckets.hour
      order by buckets.hour asc
    `;
}

function successRate(succeeded: number, finished: number): number {
  if (!Number.isFinite(finished) || finished <= 0) {
    return 0;
  }

  return succeeded / finished;
}

function mapTrendPoint(row: TrendRow): MonitoringTrendPoint {
  return {
    hour: row.hour,
    succeededRuns: Number.parseInt(row.succeeded_runs, 10),
    failedRuns: Number.parseInt(row.failed_runs, 10),
    stalledRuns: Number.parseInt(row.stalled_runs, 10),
    tokenTotal: Number.parseInt(row.token_total, 10),
    costUsd: Number.parseFloat(row.cost_usd),
  };
}

function buildMonitoringAlerts(
  summary: Omit<ControlPlaneSummary, "alertLevel" | "alerts">,
  thresholds: MonitoringThresholds,
): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];
  const failedRatio =
    summary.finishedRuns24h > 0 ? summary.failedRuns24h / summary.finishedRuns24h : 0;

  if (summary.stalledRuns > thresholds.stalledRunsCritical) {
    alerts.push({
      key: "stalled-runs",
      level: "critical",
      title: "Run 已停滞",
      detail: `${summary.stalledRuns} 个 run 已停滞，超过阈值 ${thresholds.stalledRunsCritical}，需要 operator 检查。`,
    });
  }

  if (summary.retryBacklog > thresholds.retryBacklogWarning) {
    alerts.push({
      key: "retry-backlog",
      level: "warning",
      title: "Retry Backlog 堆积",
      detail: `${summary.retryBacklog} 个 retryable run 仍在 backoff 窗口内，超过阈值 ${thresholds.retryBacklogWarning}。`,
    });
  }

  if (
    summary.finishedRuns24h >= thresholds.failureRateMinFinished &&
    failedRatio >= thresholds.failureRateCritical
  ) {
    alerts.push({
      key: "high-failure-rate",
      level: "critical",
      title: "失败率过高",
      detail: `最近 24 小时完成的 run 中有 ${Math.round(failedRatio * 100)}% 失败。`,
    });
  }

  if (summary.agentQueueLength > thresholds.queueBacklogWarning) {
    alerts.push({
      key: "queue-backlog",
      level: "warning",
      title: "Agent 队列堆积",
      detail: `${summary.agentQueueLength} 个任务正在等待 agent 派发，超过阈值 ${thresholds.queueBacklogWarning}。`,
    });
  }

  if (summary.blockedTasks > 0) {
    alerts.push({
      key: "blocked-tasks",
      level: "warning",
      title: "任务被阻塞",
      detail: `${summary.blockedTasks} 个任务处于 Blocked。`,
    });
  }

  if (summary.costUsd >= thresholds.costWarningUsd) {
    alerts.push({
      key: "cost-threshold",
      level: "warning",
      title: "成本达到阈值",
      detail: `已记录成本达到 $${summary.costUsd.toFixed(2)}，超过阈值 $${thresholds.costWarningUsd.toFixed(2)}。`,
    });
  }

  return alerts;
}

function highestAlertLevel(alerts: MonitoringAlert[]): MonitoringAlertLevel {
  if (alerts.some((alert) => alert.level === "critical")) {
    return "critical";
  }

  if (alerts.some((alert) => alert.level === "warning")) {
    return "warning";
  }

  return "ok";
}
