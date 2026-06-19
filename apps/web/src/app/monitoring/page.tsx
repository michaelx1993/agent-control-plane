import Link from "next/link";

import { getMonitoring } from "@/lib/control-plane-service";

export const dynamic = "force-dynamic";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value);
}

function formatCost(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(parsed);
}

export default async function MonitoringPage() {
  const monitoring = await getMonitoring();

  return (
    <main className="shell">
      <header className="topbar" aria-label="Production monitoring">
        <div>
          <Link className="backLink" href="/">
            Runtime Operations Console
          </Link>
          <p className="eyebrow">Production Readiness</p>
          <h1>Monitoring Dashboard</h1>
        </div>
        <a className="buttonLink" href="/prompt-metrics">
          Prompt Metrics
        </a>
      </header>

      <section className="dashboardGrid" aria-label="Monitoring sections">
        <section className="panel panelWide">
          <div className="panelHead">
            <h2>Runtime SLO Snapshot</h2>
            <span>
              {monitoring.windowHours}h window · {monitoring.generatedAt}
            </span>
          </div>
          <div className="healthGrid">
            <MetricCard
              detail={`${monitoring.queue.eligible} eligible / ${monitoring.queue.blocked} blocked`}
              label="Queue Length"
              tone={monitoring.queue.blocked > 0 ? "attention" : "nominal"}
              value={formatNumber(monitoring.queue.total)}
            />
            <MetricCard
              detail={`${monitoring.runs.succeeded} ok / ${monitoring.runs.failed} failed / ${monitoring.runs.blocked} blocked`}
              label="Run Success Rate"
              tone={monitoring.runs.failed > 0 ? "attention" : "nominal"}
              value={formatPercent(monitoring.runs.successRate)}
            />
            <MetricCard
              detail={`${formatNumber(monitoring.usage.inputTokens)} input / ${formatNumber(
                monitoring.usage.outputTokens,
              )} output`}
              label="Token Volume"
              tone="nominal"
              value={formatNumber(monitoring.usage.totalTokens)}
            />
            <MetricCard
              detail={`${monitoring.runs.running} active runs`}
              label="Cost"
              tone="nominal"
              value={formatCost(monitoring.usage.costUsd)}
            />
          </div>
        </section>

        <section className="panel panelWide">
          <div className="panelHead">
            <h2>Stalled Runs</h2>
            <span>{monitoring.stalledRuns.length} need attention</span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Task</th>
                  <th>Repo</th>
                  <th>Status</th>
                  <th>Heartbeat</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {monitoring.stalledRuns.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No stalled runs in the current window.</td>
                  </tr>
                ) : (
                  monitoring.stalledRuns.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <strong>
                          <Link href={`/runs/${run.id}`}>{run.id}</Link>
                        </strong>
                      </td>
                      <td>{run.taskId}</td>
                      <td>
                        <code>{run.repo}</code>
                      </td>
                      <td>{run.status}</td>
                      <td>{run.heartbeat}</td>
                      <td>{run.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function MetricCard({
  detail,
  label,
  tone,
  value,
}: {
  detail: string;
  label: string;
  tone: "nominal" | "attention";
  value: string;
}) {
  return (
    <article className="health">
      <div>
        <strong>{label}</strong>
        <span
          aria-hidden="true"
          className={`dot ${tone === "attention" ? "statusAttention" : "statusGood"}`}
        />
      </div>
      <b>{value}</b>
      <p>{detail}</p>
    </article>
  );
}
