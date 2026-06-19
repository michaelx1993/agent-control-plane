import Link from "next/link";

import { getPromptMetrics } from "@/lib/control-plane-service";

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function PromptMetricsPage() {
  const metrics = await getPromptMetrics();

  return (
    <main className="shell">
      <header className="topbar" aria-label="Prompt version metrics">
        <div>
          <Link className="backLink" href="/">
            Runtime Operations Console
          </Link>
          <p className="eyebrow">Prompt Observability</p>
          <h1>Prompt Version Metrics</h1>
        </div>
        <a className="buttonLink" href="/prompt-components">
          Prompt Manager
        </a>
      </header>

      <section className="panel panelWide">
        <div className="panelHead">
          <h2>Historical Run Performance</h2>
          <span>{metrics.count} prompt releases</span>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Prompt release</th>
                <th>Scope</th>
                <th>Runs</th>
                <th>Success</th>
                <th>Avg tokens</th>
                <th>Avg cost</th>
                <th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {metrics.promptMetrics.map((metric) => (
                <tr key={metric.promptReleaseId}>
                  <td>
                    <strong>{metric.promptReleaseId}</strong>
                    <span>
                      {metric.version} · {metric.hash}
                    </span>
                  </td>
                  <td>{metric.scope}</td>
                  <td>
                    <span>{metric.runCount}</span>
                    <small>
                      {metric.succeeded} ok / {metric.failed} failed / {metric.blocked} blocked
                    </small>
                  </td>
                  <td>{formatPercent(metric.successRate)}</td>
                  <td>
                    {formatNumber(metric.avgInputTokens + metric.avgOutputTokens)}
                    <small>
                      {formatNumber(metric.avgInputTokens)} in /{" "}
                      {formatNumber(metric.avgOutputTokens)} out
                    </small>
                  </td>
                  <td>{formatCost(metric.avgCostUsd)}</td>
                  <td>{metric.lastRunAt || "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
