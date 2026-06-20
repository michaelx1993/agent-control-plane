import type { AgentRole } from "@agent-control-plane/core";
import { listOperatorRuns, withDatabasePool, type RunStatus } from "@agent-control-plane/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface RunsPageProps {
  searchParams: Promise<{
    status?: string;
    repository?: string;
    role?: string;
    task?: string;
    limit?: string;
  }>;
}

const statuses = ["queued", "claimed", "running", "succeeded", "failed", "stalled"] as const;
const roles = [
  "intake",
  "development",
  "code_review",
  "merge",
  "release",
  "deploy",
  "human_gate",
  "terminal",
] as const;

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const params = await searchParams;
  const status = normalizeStatus(params.status);
  const repositorySlug = normalizeText(params.repository);
  const role = normalizeRole(params.role);
  const taskIdentifier = normalizeText(params.task);
  const limit = parseLimit(params.limit) ?? 100;
  const runs = await withDatabasePool((pool) =>
    listOperatorRuns(pool, {
      ...(status ? { status } : {}),
      ...(repositorySlug ? { repositorySlug } : {}),
      ...(role ? { role } : {}),
      ...(taskIdentifier ? { taskIdentifier } : {}),
      limit,
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
            <h1>Agent Runs</h1>
            <p className="subtle">按状态、repo、role 或任务编号筛选 agent 执行记录。</p>
          </div>
          <span className="badge">{runs.length} runs</span>
        </header>

        <section className="panel full">
          <form className="filters">
            <label>
              <span>Status</span>
              <select name="status" defaultValue={status ?? ""}>
                <option value="">全部</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Repo</span>
              <input name="repository" defaultValue={repositorySlug ?? ""} placeholder="crs-src" />
            </label>
            <label>
              <span>Role</span>
              <select name="role" defaultValue={role ?? ""}>
                <option value="">全部</option>
                {roles.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Task</span>
              <input name="task" defaultValue={taskIdentifier ?? ""} placeholder="TOK-1" />
            </label>
            <label>
              <span>Limit</span>
              <input min="1" name="limit" type="number" defaultValue={limit} />
            </label>
            <button type="submit">筛选</button>
          </form>
        </section>

        <section className="panel full">
          <div className="table-list">
            {runs.length > 0 ? (
              runs.map((run) => (
                <Link className="task-row" href={`/runs/${run.runId}`} key={run.runId}>
                  <div>
                    <h2>
                      {run.taskIdentifier} · {run.role}
                    </h2>
                    <p className="subtle">
                      {run.repositorySlug} · attempt {run.attempt}
                    </p>
                  </div>
                  <div className="task-meta">
                    <span className={`badge ${badgeClassForStatus(run.status)}`}>{run.status}</span>
                    {run.nextState ? <span className="badge ready">{run.nextState}</span> : null}
                  </div>
                  <div>
                    <p className="subtle">Lease</p>
                    <strong>{run.leaseOwner ?? "无"}</strong>
                    {run.heartbeatAt ? (
                      <p className="subtle compact-meta">heartbeat {formatDate(run.heartbeatAt)}</p>
                    ) : null}
                  </div>
                  <div>
                    <p className="subtle">{run.finishedAt ? "Finished" : "Created"}</p>
                    <strong>{formatDate(run.finishedAt ?? run.createdAt)}</strong>
                    {run.failureReason ? (
                      <p className="subtle compact-meta">{run.failureReason}</p>
                    ) : null}
                  </div>
                </Link>
              ))
            ) : (
              <p className="subtle">没有匹配 runs。</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function normalizeStatus(value?: string): RunStatus | undefined {
  return value && statuses.includes(value as RunStatus) ? (value as RunStatus) : undefined;
}

function normalizeRole(value?: string): AgentRole | undefined {
  return value && roles.includes(value as AgentRole) ? (value as AgentRole) : undefined;
}

function normalizeText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseLimit(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function badgeClassForStatus(status: RunStatus): string {
  if (status === "succeeded") {
    return "ready";
  }

  if (status === "failed" || status === "stalled") {
    return "danger";
  }

  return "warn";
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(value);
}
