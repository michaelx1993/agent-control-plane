import {
  getOperatorTimeline,
  getPromptReleases,
  getRuns,
  getSystemReadiness,
  getSystemHealth,
  getTaskQueue,
} from "@/lib/control-plane-service";
import {
  type HealthSignal,
  type OperatorTimelineItem,
  type ReadinessCheck,
  type RunStatus,
  type TaskQueueItem,
} from "@/lib/mock-data";
import { OperatorTokenPanel } from "./OperatorTokenPanel";
import { RetryTaskButton } from "./RetryTaskButton";
import { TaskTransitionControl } from "./TaskTransitionControl";

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

const timelineClass: Record<OperatorTimelineItem["tone"], string> = {
  attention: "statusAttention",
  degraded: "statusBad",
  nominal: "statusGood",
};

const readinessClass: Record<ReadinessCheck["status"], string> = {
  missing: "statusBad",
  ready: "statusGood",
  warning: "statusAttention",
};

const dispatchStatusClass: Record<TaskQueueItem["dispatchStatus"], string> = {
  budget_blocked: "pill statusBad",
  eligible: "pill statusGood",
  gated: "pill statusAttention",
  repo_concurrency: "pill statusAttention",
  retry_capped: "pill statusBad",
  role_concurrency: "pill statusAttention",
};

const dispatchStatusLabel: Record<TaskQueueItem["dispatchStatus"], string> = {
  budget_blocked: "budget blocked",
  eligible: "eligible",
  gated: "gated",
  repo_concurrency: "repo concurrency",
  retry_capped: "retry capped",
  role_concurrency: "role concurrency",
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

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type QueueFilters = {
  team: string;
  project: string;
  repo: string;
  state: string;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const [taskQueue, runs, promptReleases, systemHealth, operatorTimeline, readiness] =
    await Promise.all([
      getTaskQueue(),
      getRuns(),
      getPromptReleases(),
      getSystemHealth(),
      getOperatorTimeline(),
      getSystemReadiness(),
    ]);
  const queueFilters = normalizeQueueFilters(resolvedSearchParams);
  const filteredTasks = filterTasks(taskQueue.tasks, queueFilters);
  const filterOptions = queueFilterOptions(taskQueue.tasks);

  return (
    <main className="shell">
      <header className="topbar" aria-label="Control plane overview">
        <div>
          <p className="eyebrow">Agent Control Plane</p>
          <h1>Runtime Operations Console</h1>
        </div>
        <nav className="topActions" aria-label="Console views">
          <a className="buttonLink" href="/prompt-components">
            Prompt Manager
          </a>
          <a className="buttonLink" href="/prompt-metrics">
            Prompt Metrics
          </a>
          <a className="buttonLink" href="/monitoring">
            Monitoring
          </a>
        </nav>
        <div className="topStats" aria-label="Queue summary">
          <Metric label="Eligible" value={taskQueue.summary.eligible} />
          <Metric label="Blocked" value={taskQueue.summary.blocked} />
          <Metric label="Capped" value={taskQueue.summary.retryCapped} tone="bad" />
          <Metric label="Running" value={taskQueue.summary.running} />
          <Metric label="Failed" value={taskQueue.summary.failed} tone="bad" />
        </div>
      </header>
      <OperatorTokenPanel />

      <section className="dashboardGrid" aria-label="Admin console sections">
        <Panel
          title="Task Queue"
          meta={`${filteredTasks.length}/${taskQueue.count} mirrored Plane tasks`}
          wide
        >
          <form className="queueFilters" aria-label="Task queue filters">
            <FilterSelect
              label="Team"
              name="team"
              options={filterOptions.teams}
              value={queueFilters.team}
            />
            <FilterSelect
              label="Project"
              name="project"
              options={filterOptions.projects}
              value={queueFilters.project}
            />
            <FilterSelect
              label="Repo"
              name="repo"
              options={filterOptions.repos}
              value={queueFilters.repo}
            />
            <FilterSelect
              label="State"
              name="state"
              options={filterOptions.states}
              value={queueFilters.state}
            />
            <div className="queueFilterActions">
              <button className="primaryButton" type="submit">
                Apply
              </button>
              <a className="buttonLink" href="/">
                Clear
              </a>
            </div>
          </form>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Plane task</th>
                  <th>Team / Project</th>
                  <th>Repo</th>
                  <th>State</th>
                  <th>Priority</th>
                  <th>Dispatch</th>
                  <th>Attempt</th>
                  <th>Lease</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.id}</strong>
                      <span>{task.planeTask}</span>
                    </td>
                    <td>
                      <strong>{task.team}</strong>
                      <span>{task.project}</span>
                    </td>
                    <td>
                      <code>{task.repo}</code>
                    </td>
                    <td>{task.state}</td>
                    <td>{task.priority}</td>
                    <td>
                      <span className={dispatchStatusClass[task.dispatchStatus]}>
                        {dispatchStatusLabel[task.dispatchStatus]}
                      </span>
                    </td>
                    <td>
                      {task.attempt}/{task.maxAttempts}
                    </td>
                    <td>
                      <span>{task.lease}</span>
                      {task.dispatchStatus === "retry_capped" ? (
                        <RetryTaskButton taskId={task.id} />
                      ) : null}
                    </td>
                    <td>
                      <TaskTransitionControl taskId={task.id} state={task.state} />
                    </td>
                  </tr>
                ))}
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <span className="emptyText">No tasks match the selected filters.</span>
                    </td>
                  </tr>
                ) : null}
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
                    <dt>Attempt</dt>
                    <dd>
                      {run.attempt}/{run.maxAttempts}
                    </dd>
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

        <Panel title="Operator Timeline" meta={`${operatorTimeline.count} recent events`}>
          <div className="compactTimeline">
            {operatorTimeline.timeline.map((item) => (
              <a className="compactTimelineItem" href={item.href} key={item.id}>
                <span className={`dot ${timelineClass[item.tone]}`} aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.createdAt}</small>
                  <p>{item.detail}</p>
                </div>
              </a>
            ))}
          </div>
        </Panel>

        <Panel title="Readiness" meta={readiness.status}>
          <div className="readinessStack">
            {readiness.categories.map((category) => (
              <article className="readinessGroup" key={category.id}>
                <h3>{category.label}</h3>
                <div>
                  {category.checks.map((check) => (
                    <div className="readinessCheck" key={check.id}>
                      <span className={`pill ${readinessClass[check.status]}`}>{check.status}</span>
                      <div>
                        <strong>{check.label}</strong>
                        <small>{check.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function normalizeQueueFilters(
  params: Record<string, string | string[] | undefined>,
): QueueFilters {
  return {
    team: firstParam(params.team),
    project: firstParam(params.project),
    repo: firstParam(params.repo),
    state: firstParam(params.state),
  };
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function filterTasks(tasks: TaskQueueItem[], filters: QueueFilters): TaskQueueItem[] {
  return tasks.filter((task) => {
    return (
      (!filters.team || task.team === filters.team) &&
      (!filters.project || task.project === filters.project) &&
      (!filters.repo || task.repo === filters.repo) &&
      (!filters.state || task.state === filters.state)
    );
  });
}

function queueFilterOptions(tasks: TaskQueueItem[]) {
  return {
    projects: uniqueSorted(tasks.map((task) => task.project)),
    repos: uniqueSorted(tasks.map((task) => task.repo).filter(Boolean)),
    states: uniqueSorted(tasks.map((task) => task.state)),
    teams: uniqueSorted(tasks.map((task) => task.team)),
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function FilterSelect({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: keyof QueueFilters;
  options: string[];
  value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select name={name} defaultValue={value}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
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
