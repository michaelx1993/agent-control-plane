import { getDashboardSnapshot } from "../src/dashboard";
import Link from "next/link";
import type { MonitoringTrendWindow } from "@agent-control-plane/db";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams?: Promise<{
    trend?: string;
  }>;
}

const trendWindows = ["12h", "24h", "7d"] as const;

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const trendWindow = normalizeTrendWindow(params?.trend);
  const snapshot = await getDashboardSnapshot({ trendWindow });
  const readyCount = snapshot.modules.filter((module) => module.status === "ready").length;
  const agentStates = snapshot.workflow.filter((item) => item.mode === "agent").length;
  const humanGates = snapshot.workflow.filter((item) => item.mode === "human").length;
  const summary = snapshot.database?.summary;
  const trendMax = summary
    ? Math.max(
        1,
        ...summary.runTrend.map(
          (point) => point.succeededRuns + point.failedRuns + point.stalledRuns,
        ),
      )
    : 1;
  const trendPreview = summary?.runTrend ?? [];

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <h1>Agent Control Plane</h1>
            <p className="subtle">Plane 任务层、Control Plane 调度层、Codex Worker 执行层。</p>
          </div>
          <span className="badge warn">开发中</span>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>模块就绪</h2>
            <p className="metric">
              {readyCount}/{snapshot.modules.length}
            </p>
            <p className="subtle">当前只统计本仓库已验证模块。</p>
          </article>

          <article className="panel">
            <h2>自动状态</h2>
            <p className="metric">{agentStates}</p>
            <p className="subtle">这些状态会进入 agent 派发队列。</p>
          </article>

          <article className="panel">
            <h2>人工门</h2>
            <p className="metric">{humanGates}</p>
            <p className="subtle">这些状态必须等待人类判定。</p>
          </article>

          <article className="panel full">
            <h2>运行监控</h2>
            {summary ? (
              <div className="monitoring-stack">
                <div className="monitoring-header">
                  <div>
                    <h3>告警状态</h3>
                    <p className="subtle">
                      基于当前队列、停滞、retry backlog、失败率、阻塞和成本阈值。
                    </p>
                  </div>
                  <span className={`badge ${alertBadgeClass(summary.alertLevel)}`}>
                    {formatAlertLevel(summary.alertLevel)}
                  </span>
                </div>

                {summary.alerts.length > 0 ? (
                  <div className="alert-list">
                    {summary.alerts.map((alert) => (
                      <div className={`alert-card ${alert.level}`} key={alert.key}>
                        <strong>{alert.title}</strong>
                        <span>{alert.detail}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle">暂无运行告警。</p>
                )}

                <div className="metrics-grid">
                  <div className="metric-card">
                    <span>Agent Queue</span>
                    <strong>{summary.agentQueueLength}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Active Runs</span>
                    <strong>{summary.activeRuns}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Human Gates</span>
                    <strong>{summary.humanGateTasks}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Blocked</span>
                    <strong>{summary.blockedTasks}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Stalled</span>
                    <strong>{summary.stalledRuns}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Retry Backlog</span>
                    <strong>{summary.retryBacklog}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Success 24h</span>
                    <strong>{formatPercent(summary.runSuccessRate24h)}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Failed 24h</span>
                    <strong>{summary.failedRuns24h}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Tokens</span>
                    <strong>{formatInteger(summary.tokenTotal)}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Cost</span>
                    <strong>{formatCurrency(summary.costUsd)}</strong>
                  </div>
                </div>

                <div className="threshold-grid">
                  <div>
                    <span>Queue Warning</span>
                    <strong>&gt; {summary.monitoringThresholds.queueBacklogWarning}</strong>
                  </div>
                  <div>
                    <span>Failure Critical</span>
                    <strong>
                      {formatPercent(summary.monitoringThresholds.failureRateCritical)}
                    </strong>
                  </div>
                  <div>
                    <span>Min Finished</span>
                    <strong>{summary.monitoringThresholds.failureRateMinFinished}</strong>
                  </div>
                  <div>
                    <span>Retry Backoff</span>
                    <strong>{formatDuration(summary.monitoringThresholds.retryBackoffMs)}</strong>
                  </div>
                  <div>
                    <span>Retry Backlog</span>
                    <strong>&gt; {summary.monitoringThresholds.retryBacklogWarning}</strong>
                  </div>
                  <div>
                    <span>Cost Warning</span>
                    <strong>{formatCurrency(summary.monitoringThresholds.costWarningUsd)}</strong>
                  </div>
                </div>

                <div className="trend-panel">
                  <div className="trend-header">
                    <div>
                      <h3>{labelForTrendWindow(summary.runTrendWindow)} Run 趋势</h3>
                      <p className="subtle">
                        Succeeded / Failed / Stalled 按
                        {summary.runTrendWindow === "7d" ? "完成日期" : "完成小时"}聚合。
                      </p>
                    </div>
                    <div className="segmented-control" aria-label="Trend window">
                      {trendWindows.map((window) => (
                        <Link
                          className={window === summary.runTrendWindow ? "active" : ""}
                          href={`/?trend=${window}`}
                          key={window}
                        >
                          {window}
                        </Link>
                      ))}
                    </div>
                  </div>
                  <div className="trend-grid">
                    {trendPreview.map((point) => {
                      const total = point.succeededRuns + point.failedRuns + point.stalledRuns;
                      const label = formatTrendBucket(point.hour, summary.runTrendWindow);
                      return (
                        <div className="trend-column" key={point.hour}>
                          <div className="trend-bars" title={`${label} · ${total}`}>
                            <span
                              className="trend-bar ready"
                              style={{
                                height: `${barHeight(point.succeededRuns, trendMax)}%`,
                              }}
                            />
                            <span
                              className="trend-bar warn"
                              style={{
                                height: `${barHeight(point.failedRuns, trendMax)}%`,
                              }}
                            />
                            <span
                              className="trend-bar danger"
                              style={{
                                height: `${barHeight(point.stalledRuns, trendMax)}%`,
                              }}
                            />
                          </div>
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="subtle">数据库未连接，暂无运行监控。</p>
            )}
          </article>

          <article className="panel wide">
            <h2>最近 Runs</h2>
            <Link className="detail-link" href="/runs">
              <strong>打开 Runs</strong>
              <span>按状态、repo、role 和任务编号筛选执行记录</span>
            </Link>
            <div className="list">
              {snapshot.recentRuns.length > 0 ? (
                snapshot.recentRuns.map((run) => (
                  <Link className="row link-row" href={`/runs/${run.runId}`} key={run.runId}>
                    <div>
                      <h3>
                        {run.taskIdentifier} · {run.role}
                      </h3>
                      <p className="subtle">
                        {run.repositorySlug} · attempt {run.attempt} · {run.status}
                      </p>
                    </div>
                    <span className={`badge ${run.status === "succeeded" ? "ready" : "warn"}`}>
                      {run.status}
                    </span>
                  </Link>
                ))
              ) : (
                <p className="subtle">暂无 run 数据。</p>
              )}
            </div>
          </article>

          <article className="panel">
            <h2>Prompt Releases</h2>
            <Link className="detail-link" href="/prompt-components">
              <strong>打开 Prompt Manager</strong>
              <span>管理 component、版本、diff 和 rollback</span>
            </Link>
            <Link className="detail-link" href="/settings">
              <strong>打开 Project Settings</strong>
              <span>管理 repo、role、agent definition 和 prompt binding</span>
            </Link>
            <Link className="detail-link" href="/audit">
              <strong>打开 Audit</strong>
              <span>查看 actor、action、entity 和时间窗口审计</span>
            </Link>
            <div className="list">
              {snapshot.recentPromptReleases.length > 0 ? (
                snapshot.recentPromptReleases.map((release) => (
                  <Link
                    className="row link-row"
                    href={`/prompt-releases/${release.id}`}
                    key={release.id}
                  >
                    <div>
                      <h3>{release.taskIdentifier}</h3>
                      <p className="subtle">
                        {release.repositorySlug} · {release.roleKey} · {release.componentCount}{" "}
                        components
                      </p>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="subtle">暂无 prompt release。</p>
              )}
            </div>
          </article>

          <article className="panel wide">
            <h2>模块状态</h2>
            <div className="list">
              {snapshot.modules.map((module) => (
                <div className="row" key={module.name}>
                  <div>
                    <h3>{module.name}</h3>
                    <p className="subtle">{module.detail}</p>
                  </div>
                  <span className={`badge ${module.status === "ready" ? "ready" : "warn"}`}>
                    {module.status === "ready" ? "ready" : "pending"}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <h2>运行入口</h2>
            <div className="list">
              <div>
                <h3>控制台</h3>
                <p className="subtle">
                  <code>pnpm dev</code>
                </p>
              </div>
              <div>
                <h3>Worker</h3>
                <p className="subtle">
                  <code>pnpm worker</code>
                </p>
              </div>
              <div>
                <h3>门禁</h3>
                <p className="subtle">
                  <code>pnpm format && pnpm check && pnpm build</code>
                </p>
              </div>
            </div>
          </article>

          <article className="panel wide">
            <h2>状态路由</h2>
            <div className="list">
              {snapshot.workflow.map((item) => (
                <div className="row" key={item.state}>
                  <div>
                    <h3>{item.state}</h3>
                    <p className="subtle">{item.role}</p>
                  </div>
                  <span className={`badge ${item.mode === "agent" ? "ready" : ""}`}>
                    {item.mode}
                  </span>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

function normalizeTrendWindow(value?: string): MonitoringTrendWindow {
  return value && trendWindows.includes(value as MonitoringTrendWindow)
    ? (value as MonitoringTrendWindow)
    : "24h";
}

function labelForTrendWindow(value: MonitoringTrendWindow): string {
  const labels: Record<MonitoringTrendWindow, string> = {
    "12h": "近 12 小时",
    "24h": "近 24 小时",
    "7d": "近 7 天",
  };
  return labels[value];
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function formatDuration(valueMs: number): string {
  const minutes = Math.round(valueMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatAlertLevel(level: "ok" | "warning" | "critical"): string {
  if (level === "critical") {
    return "critical";
  }

  if (level === "warning") {
    return "warning";
  }

  return "ok";
}

function alertBadgeClass(level: "ok" | "warning" | "critical"): string {
  if (level === "critical") {
    return "danger";
  }

  if (level === "warning") {
    return "warn";
  }

  return "ready";
}

function formatTrendBucket(value: string, window: MonitoringTrendWindow): string {
  if (window === "7d") {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function barHeight(value: number, max: number): number {
  if (value <= 0) {
    return 3;
  }

  return Math.max(8, Math.round((value / max) * 100));
}
