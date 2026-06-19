import {
  getPromptReleases,
  getRuns,
  getSystemHealth,
  getTaskQueue,
} from "@/lib/control-plane-service";
import { type HealthSignal, type RunStatus } from "@/lib/mock-data";

const statusClass: Record<RunStatus | HealthSignal["state"], string> = {
  attention: "statusAttention",
  blocked: "statusAttention",
  claimed: "statusInfo",
  completed: "statusGood",
  degraded: "statusBad",
  failed: "statusBad",
  nominal: "statusGood",
  queued: "statusInfo",
  running: "statusRun",
};

const formatTokens = (input: number, output: number) =>
  new Intl.NumberFormat("en-US").format(input + output);

const formatCost = (costUsd: string) => {
  const parsed = Number(costUsd);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "$0.00";
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(parsed);
};

export default async function DashboardPage() {
  const [taskQueue, runs, promptReleases, systemHealth] = await Promise.all([
    getTaskQueue(),
    getRuns(),
    getPromptReleases(),
    getSystemHealth(),
  ]);

  return (
    <main className="shell">
      <header className="topbar" aria-label="Control plane overview">
        <div>
          <p className="eyebrow">Agent Control Plane</p>
          <h1>Runtime Operations Console</h1>
        </div>
        <a className="buttonLink" href="/prompt-components">
          Prompt Manager
        </a>
        <div className="topStats" aria-label="Queue summary">
          <Metric label="Eligible" value={taskQueue.summary.eligible} />
          <Metric label="Blocked" value={taskQueue.summary.blocked} />
          <Metric label="Running" value={taskQueue.summary.running} />
          <Metric label="Failed" value={taskQueue.summary.failed} tone="bad" />
        </div>
      </header>

      <section className="dashboardGrid" aria-label="Admin console sections">
        <Panel title="Task Queue" meta={`${taskQueue.count} mirrored Plane tasks`} wide>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Plane task</th>
                  <th>Repo</th>
                  <th>State</th>
                  <th>Priority</th>
                  <th>Dispatch</th>
                  <th>Lease</th>
                </tr>
              </thead>
              <tbody>
                {taskQueue.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.id}</strong>
                      <span>{task.planeTask}</span>
                    </td>
                    <td>
                      <code>{task.repo}</code>
                    </td>
                    <td>{task.state}</td>
                    <td>{task.priority}</td>
                    <td>
                      <span className={task.eligible ? "pill statusGood" : "pill statusAttention"}>
                        {task.eligible ? "eligible" : "gated"}
                      </span>
                    </td>
                    <td>{task.lease}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Runs" meta={`${runs.count} recent agent runs`} wide>
          <div className="runList">
            {runs.runs.map((run) => (
              <article className="runRow" key={run.id}>
                <div className="runMain">
                  <div>
                    <strong>
                      <a href={`/runs/${run.id}`}>{run.id}</a>
                    </strong>
                    <span>
                      {run.taskId} · {run.repo} · {run.role}
                    </span>
                  </div>
                  <span className={`pill ${statusClass[run.status]}`}>{run.status}</span>
                </div>
                <dl className="runMeta">
                  <div>
                    <dt>Prompt</dt>
                    <dd>{run.promptReleaseId}</dd>
                  </div>
                  <div>
                    <dt>Started</dt>
                    <dd>{run.startedAt}</dd>
                  </div>
                  <div>
                    <dt>Heartbeat</dt>
                    <dd>{run.heartbeat}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd>{formatTokens(run.tokenInput, run.tokenOutput)}</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>{formatCost(run.costUsd)}</dd>
                  </div>
                </dl>
                <div className="links">
                  <a href={run.openHandsUrl}>OpenHands conversation</a>
                  <a href={run.langfuseUrl}>Langfuse trace</a>
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="Prompt Releases" meta="immutable run bindings">
          <div className="releaseStack">
            {promptReleases.promptReleases.map((release) => (
              <article className="release" key={release.id}>
                <div className="releaseHead">
                  <strong>{release.id}</strong>
                  <span
                    className={`pill ${release.status === "active" ? "statusGood" : "statusInfo"}`}
                  >
                    {release.status}
                  </span>
                </div>
                <p>{release.scope}</p>
                <dl>
                  <div>
                    <dt>Version</dt>
                    <dd>{release.version}</dd>
                  </div>
                  <div>
                    <dt>Hash</dt>
                    <dd>{release.hash}</dd>
                  </div>
                  <div>
                    <dt>Author</dt>
                    <dd>{release.updatedBy}</dd>
                  </div>
                </dl>
                <small>{release.changelog}</small>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="System Health" meta="runtime dependencies">
          <div className="healthGrid">
            {systemHealth.signals.map((signal) => (
              <article className="health" key={signal.name}>
                <div>
                  <strong>{signal.name}</strong>
                  <span className={`dot ${statusClass[signal.state]}`} aria-hidden="true" />
                </div>
                <b>{signal.value}</b>
                <p>{signal.detail}</p>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "bad";
}) {
  return (
    <div className={tone === "bad" ? "metric metricBad" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({
  title,
  meta,
  wide = false,
  children,
}: Readonly<{
  title: string;
  meta: string;
  wide?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <section className={wide ? "panel panelWide" : "panel"}>
      <div className="panelHead">
        <h2>{title}</h2>
        <span>{meta}</span>
      </div>
      {children}
    </section>
  );
}
