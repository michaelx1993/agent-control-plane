import { isWorkflowState } from "@agent-control-plane/core";
import {
  listOperatorTasks,
  withDatabasePool,
  type TaskLeaseFilter,
  type TaskQueueMode,
  type TaskRetryFilter,
} from "@agent-control-plane/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    mode?: string;
    state?: string;
    project?: string;
    repository?: string;
    lease?: string;
    retry?: string;
  }>;
}

const modes = ["all", "agent", "human", "blocked", "terminal"] as const;
const leaseFilters = ["active", "none", "expired"] as const;
const retryFilters = ["retryable", "waiting", "ready", "blocked"] as const;

export default async function TasksPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const mode = normalizeMode(params.mode) ?? "all";
  const state = normalizeState(params.state);
  const projectSlug = normalizeText(params.project);
  const repositorySlug = normalizeText(params.repository);
  const lease = normalizeLeaseFilter(params.lease);
  const retry = normalizeRetryFilter(params.retry);
  const tasks = await withDatabasePool((pool) =>
    listOperatorTasks(pool, {
      mode,
      ...(state ? { state } : {}),
      ...(projectSlug ? { projectSlug } : {}),
      ...(repositorySlug ? { repositorySlug } : {}),
      ...(lease ? { lease } : {}),
      ...(retry ? { retry } : {}),
      limit: 100,
    }),
  );

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/">
              ← 控制台
            </Link>
            <h1>任务队列</h1>
            <p className="subtle">查看 agent 接单、人工门、阻塞和终态任务。</p>
          </div>
          <span className="badge">{tasks.length} tasks</span>
        </header>

        <section className="panel full">
          <form className="filters">
            <label>
              <span>Mode</span>
              <select name="mode" defaultValue={mode}>
                {modes.map((item) => (
                  <option key={item} value={item}>
                    {labelForMode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>State</span>
              <input name="state" defaultValue={state ?? ""} placeholder="Human Review" />
            </label>
            <label>
              <span>Project</span>
              <input name="project" defaultValue={projectSlug ?? ""} placeholder="token" />
            </label>
            <label>
              <span>Repo</span>
              <input name="repository" defaultValue={repositorySlug ?? ""} placeholder="crs-src" />
            </label>
            <label>
              <span>Lease</span>
              <select name="lease" defaultValue={lease ?? ""}>
                <option value="">全部</option>
                {leaseFilters.map((item) => (
                  <option key={item} value={item}>
                    {labelForLease(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Retry</span>
              <select name="retry" defaultValue={retry ?? ""}>
                <option value="">全部</option>
                {retryFilters.map((item) => (
                  <option key={item} value={item}>
                    {labelForRetry(item)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">筛选</button>
          </form>
        </section>

        <section className="panel full">
          <div className="table-list">
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <Link className="task-row" href={`/tasks/${task.taskId}`} key={task.taskId}>
                  <div>
                    <h2>
                      {task.identifier} · {task.title}
                    </h2>
                    <p className="subtle">
                      {task.projectSlug}
                      {task.repositorySlug ? ` / ${task.repositorySlug}` : " / 未绑定 repo"} ·{" "}
                      {task.role}
                    </p>
                  </div>
                  <div className="task-meta">
                    <span className={`badge ${badgeClassForMode(task.mode)}`}>
                      {labelForMode(task.mode)}
                    </span>
                    <span className="badge">{task.state}</span>
                    {task.activeRun ? (
                      <span className="badge warn">{task.activeRun.status}</span>
                    ) : null}
                    {task.activeRun ? <span className="badge ready">活跃租约</span> : null}
                    {task.latestRun?.retryable === true ? (
                      <span className="badge warn">
                        {task.latestRun.retryAfterAt &&
                        task.latestRun.retryAfterAt.getTime() > Date.now()
                          ? "退避中"
                          : "可重试"}
                      </span>
                    ) : null}
                    {task.latestRun?.retryable === false ? (
                      <span className="badge danger">不可重试</span>
                    ) : null}
                  </div>
                  <div>
                    <p className="subtle">Latest</p>
                    <strong>{task.latestRun?.status ?? "无"}</strong>
                    {task.latestRun ? (
                      <p className="subtle compact-meta">{formatRunMeta(task.latestRun)}</p>
                    ) : null}
                  </div>
                  <div>
                    <p className="subtle">{task.activeRun ? "Active Lease" : "Updated"}</p>
                    <strong>
                      {task.activeRun?.leaseExpiresAt
                        ? formatDate(task.activeRun.leaseExpiresAt)
                        : formatDate(task.updatedAt)}
                    </strong>
                    {task.activeRun?.heartbeatAt ? (
                      <p className="subtle compact-meta">
                        heartbeat {formatDate(task.activeRun.heartbeatAt)}
                      </p>
                    ) : null}
                  </div>
                </Link>
              ))
            ) : (
              <p className="subtle">没有匹配任务。</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function normalizeMode(value?: string): TaskQueueMode | undefined {
  return value && modes.includes(value as TaskQueueMode) ? (value as TaskQueueMode) : undefined;
}

function normalizeLeaseFilter(value?: string): TaskLeaseFilter | undefined {
  return value && leaseFilters.includes(value as TaskLeaseFilter)
    ? (value as TaskLeaseFilter)
    : undefined;
}

function normalizeRetryFilter(value?: string): TaskRetryFilter | undefined {
  return value && retryFilters.includes(value as TaskRetryFilter)
    ? (value as TaskRetryFilter)
    : undefined;
}

function normalizeState(value?: string) {
  return value && isWorkflowState(value) ? value : undefined;
}

function normalizeText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function labelForMode(mode: TaskQueueMode): string {
  const labels: Record<TaskQueueMode, string> = {
    all: "全部",
    agent: "Agent",
    human: "人工门",
    blocked: "阻塞",
    terminal: "终态",
  };
  return labels[mode];
}

function badgeClassForMode(mode: TaskQueueMode): string {
  if (mode === "agent") {
    return "ready";
  }

  if (mode === "human" || mode === "blocked") {
    return "warn";
  }

  return "";
}

function labelForLease(value: TaskLeaseFilter): string {
  const labels: Record<TaskLeaseFilter, string> = {
    active: "活跃租约",
    none: "无活跃租约",
    expired: "租约已过期",
  };
  return labels[value];
}

function labelForRetry(value: TaskRetryFilter): string {
  const labels: Record<TaskRetryFilter, string> = {
    retryable: "可重试",
    waiting: "退避中",
    ready: "可重试已到期",
    blocked: "不可重试阻塞",
  };
  return labels[value];
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(value);
}

function formatRunMeta(run: {
  attempt?: number;
  leaseOwner?: string;
  retryable?: boolean;
  retryAfterAt?: Date;
}): string {
  const parts = [];
  if (run.attempt !== undefined) {
    parts.push(`attempt ${run.attempt}`);
  }
  if (run.leaseOwner) {
    parts.push(run.leaseOwner);
  }
  if (run.retryable !== undefined) {
    parts.push(run.retryable ? "retryable" : "blocked");
  }
  if (run.retryAfterAt) {
    parts.push(`retry after ${formatDate(run.retryAfterAt)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "无运行细节";
}
