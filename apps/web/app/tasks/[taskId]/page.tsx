import { isWorkflowState } from "@agent-control-plane/core";
import {
  getTaskDetail,
  requestTaskRework,
  transitionTaskState,
  withDatabasePool,
} from "@agent-control-plane/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    taskId: string;
  }>;
}

export default async function TaskDetailPage({ params }: PageProps) {
  const { taskId } = await params;
  const task = await withDatabasePool((pool) => getTaskDetail(pool, taskId));

  if (!task) {
    notFound();
  }

  async function transitionAction(formData: FormData) {
    "use server";
    const targetState = String(formData.get("targetState") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!isWorkflowState(targetState)) {
      throw new Error("Invalid target state");
    }

    const result = await withDatabasePool((pool) =>
      transitionTaskState(pool, {
        taskId,
        targetState,
        actor: "operator-ui",
        ...(reason ? { reason } : {}),
      }),
    );
    if (!result.updated) {
      throw new Error(`Transition failed: ${result.reason ?? "unknown"}`);
    }

    redirect(`/tasks/${taskId}`);
  }

  async function reworkAction(formData: FormData) {
    "use server";
    const body = String(formData.get("body") ?? "").trim();
    const severity = String(formData.get("severity") ?? "major");
    if (!body) {
      throw new Error("Feedback body is required");
    }

    const result = await withDatabasePool((pool) =>
      requestTaskRework(pool, {
        taskId,
        body,
        source: "human",
        severity: isSeverity(severity) ? severity : "major",
      }),
    );
    if (!result.updated) {
      throw new Error(`Rework failed: ${result.reason ?? "unknown"}`);
    }

    redirect(`/tasks/${taskId}`);
  }

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/tasks">
              ← 任务队列
            </Link>
            <h1>
              {task.identifier} · {task.title}
            </h1>
            <p className="subtle">
              {task.projectSlug}
              {task.repositorySlug ? ` / ${task.repositorySlug}` : " / 未绑定 repo"} · {task.role}
            </p>
          </div>
          <span className={`badge ${task.mode === "agent" ? "ready" : "warn"}`}>{task.state}</span>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>任务</h2>
            <div className="kv">
              <span>Plane</span>
              <strong>{task.externalTaskId}</strong>
              <span>Assignee</span>
              <strong>{task.assignee ?? "无"}</strong>
              <span>Priority</span>
              <strong>{task.priority ?? "无"}</strong>
              <span>Labels</span>
              <strong>{task.labels.length > 0 ? task.labels.join(", ") : "无"}</strong>
            </div>
          </article>

          <article className="panel">
            <h2>接单</h2>
            <div className="kv">
              <span>Mode</span>
              <strong>{task.mode}</strong>
              <span>Role</span>
              <strong>{task.role}</strong>
              <span>Active</span>
              <strong>{formatRunHeadline(task.activeRun)}</strong>
              <span>Lease</span>
              <strong>{formatLease(task.activeRun)}</strong>
              <span>Latest</span>
              <strong>{formatRunHeadline(task.latestRun)}</strong>
              <span>Retry</span>
              <strong>{formatRetry(task.latestRun)}</strong>
            </div>
          </article>

          <article className="panel">
            <h2>状态流转</h2>
            <form action={transitionAction} className="action-form">
              <textarea name="reason" placeholder="原因" rows={3} />
              <div className="button-row">
                {task.allowedNextStates.map((state) => (
                  <button key={state} name="targetState" type="submit" value={state}>
                    {state}
                  </button>
                ))}
              </div>
            </form>
          </article>

          <article className="panel wide">
            <h2>打回 Development</h2>
            <form action={reworkAction} className="action-form">
              <textarea name="body" placeholder="返工意见" rows={5} />
              <select name="severity" defaultValue="major">
                <option value="minor">minor</option>
                <option value="major">major</option>
                <option value="blocker">blocker</option>
              </select>
              <button type="submit">打回</button>
            </form>
          </article>

          <article className="panel wide">
            <h2>未解决反馈</h2>
            <div className="list">
              {task.unresolvedFeedback.length > 0 ? (
                task.unresolvedFeedback.map((feedback) => (
                  <div className="row" key={feedback.id}>
                    <div>
                      <h3>
                        {feedback.source} · {feedback.severity}
                      </h3>
                      <p className="body-text">{feedback.body}</p>
                    </div>
                    <span className="subtle">{formatDate(feedback.createdAt)}</span>
                  </div>
                ))
              ) : (
                <p className="subtle">暂无未解决反馈。</p>
              )}
            </div>
          </article>

          <article className="panel wide">
            <h2>Progress / Workpad</h2>
            <div className="list">
              {task.progressItems.length > 0 ? (
                task.progressItems.map((progress) => (
                  <div className="row" key={progress.id}>
                    <div>
                      <h3>{progress.source}</h3>
                      <p className="body-text">{progress.body}</p>
                    </div>
                    <span className="subtle">{formatDate(progress.createdAt)}</span>
                  </div>
                ))
              ) : (
                <p className="subtle">暂无 agent progress。</p>
              )}
            </div>
          </article>

          <article className="panel wide">
            <h2>Runs</h2>
            <div className="list">
              {task.runs.length > 0 ? (
                task.runs.map((run) => (
                  <Link className="row link-row" href={`/runs/${run.runId}`} key={run.runId}>
                    <div>
                      <h3>
                        {run.role} · {run.status}
                        {run.attempt !== undefined ? ` · attempt ${run.attempt}` : ""}
                      </h3>
                      <p className="subtle">
                        {run.resultSummary ?? run.failureReason ?? run.nextState ?? "无摘要"}
                      </p>
                      <p className="subtle compact-meta">
                        {formatRunTimeline(run)}
                        {formatRetry(run) !== "无" ? ` · ${formatRetry(run)}` : ""}
                      </p>
                    </div>
                    <span className="subtle">{formatDate(run.updatedAt)}</span>
                  </Link>
                ))
              ) : (
                <p className="subtle">暂无 run。</p>
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

function isSeverity(value: string): value is "minor" | "major" | "blocker" {
  return value === "minor" || value === "major" || value === "blocker";
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(value);
}

function formatOptionalDate(value?: Date): string {
  return value ? formatDate(value) : "无";
}

function formatRunHeadline(
  run:
    | {
        status: string;
        attempt?: number;
      }
    | undefined,
): string {
  if (!run) {
    return "无";
  }

  return run.attempt !== undefined ? `${run.status} · attempt ${run.attempt}` : run.status;
}

function formatLease(
  run:
    | {
        leaseOwner?: string;
        leaseExpiresAt?: Date;
        heartbeatAt?: Date;
      }
    | undefined,
): string {
  if (!run?.leaseOwner && !run?.leaseExpiresAt && !run?.heartbeatAt) {
    return "无";
  }

  return [
    run.leaseOwner,
    run.leaseExpiresAt ? `expires ${formatDate(run.leaseExpiresAt)}` : undefined,
    run.heartbeatAt ? `heartbeat ${formatDate(run.heartbeatAt)}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatRetry(
  run:
    | {
        retryable?: boolean;
        retryAfterAt?: Date;
      }
    | undefined,
): string {
  if (!run || run.retryable === undefined) {
    return "无";
  }

  if (!run.retryable) {
    return "non-retryable";
  }

  return run.retryAfterAt ? `retry after ${formatDate(run.retryAfterAt)}` : "retryable";
}

function formatRunTimeline(run: {
  createdAt: Date;
  startedAt?: Date;
  heartbeatAt?: Date;
  finishedAt?: Date;
  leaseExpiresAt?: Date;
}): string {
  return [
    `created ${formatDate(run.createdAt)}`,
    run.startedAt ? `started ${formatDate(run.startedAt)}` : undefined,
    run.heartbeatAt ? `heartbeat ${formatDate(run.heartbeatAt)}` : undefined,
    run.leaseExpiresAt ? `lease ${formatDate(run.leaseExpiresAt)}` : undefined,
    run.finishedAt ? `finished ${formatDate(run.finishedAt)}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
