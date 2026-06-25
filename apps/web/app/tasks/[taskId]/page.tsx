import { isWorkflowState } from "@agent-control-plane/core";
import {
  getTaskDetail,
  previewPlaneRuntimeForTask,
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
  const { task, runPreview } = await withDatabasePool(async (pool) => {
    const task = await getTaskDetail(pool, taskId);
    if (!task) {
      return { task, runPreview: undefined };
    }

    return {
      task,
      runPreview: await previewPlaneRuntimeForTask(pool, { taskId }),
    };
  });

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

          <article className="panel wide">
            <h2>Run Preview</h2>
            {runPreview ? (
              <>
                <div className="kv">
                  <span>Role</span>
                  <strong>
                    {firstString(runPreview.payload.role, ["key", "name"]) ?? task.role}
                  </strong>
                  <span>Agent</span>
                  <strong>
                    {firstString(runPreview.payload.agent, ["name", "model"]) ?? "无"}
                  </strong>
                  <span>Worker</span>
                  <strong>
                    {firstString(runPreview.payload.worker, ["workerId", "name"]) ?? "无"}
                  </strong>
                  <span>Hash</span>
                  <strong>{runPreview.snapshotHash.slice(0, 16)}</strong>
                  <span>Created</span>
                  <strong>{formatDate(runPreview.createdAt)}</strong>
                </div>
                <div className="snapshot-grid">
                  <section>
                    <h3>Prompt stack</h3>
                    {runPreview.payload.prompts.length > 0 ? (
                      <ol className="stack-list">
                        {runPreview.payload.prompts.map((prompt, index) => (
                          <li key={`${index}-${formatPromptVersion(prompt.version)}`}>
                            <strong>{formatPromptTitle(prompt.prompt)}</strong>
                            <span>{formatPromptMeta(prompt.binding, prompt.version)}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="subtle">未命中 Plane prompt binding。</p>
                    )}
                  </section>
                  <section>
                    <h3>Secret keys</h3>
                    {runPreview.payload.availableSecretKeys.length > 0 ? (
                      <div className="chip-list">
                        {runPreview.payload.availableSecretKeys.map((secretKey) => (
                          <span className="chip" key={secretKey}>
                            {secretKey}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="subtle">无可用 secret key。</p>
                    )}
                  </section>
                </div>
                <h3>Assembled prompt preview</h3>
                <pre className="inline-code prompt-preview">
                  {formatPromptPreview(runPreview.payload.assembledPrompt)}
                </pre>
              </>
            ) : (
              <p className="subtle">
                当前任务不可预览 agent run。需要自动执行状态、已注册 repository 和 active agent。
              </p>
            )}
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

function formatPromptPreview(value: string): string {
  const limit = 12000;
  if (value.length <= limit) {
    return value || "无 assembled prompt。";
  }

  return `${value.slice(0, limit)}\n\n...[truncated ${value.length - limit} chars]`;
}

function formatPromptTitle(record: Record<string, unknown>): string {
  return firstString(record, ["name", "title", "key", "id"]) ?? "Prompt";
}

function formatPromptVersion(record: Record<string, unknown>): string {
  return firstString(record, ["version", "versionId", "id", "contentHash"]) ?? "unknown";
}

function formatPromptMeta(
  binding: Record<string, unknown>,
  version: Record<string, unknown>,
): string {
  const parts = [
    firstString(binding, ["scope"]),
    firstString(binding, ["kind"]),
    firstString(binding, ["targetType"]),
    `version ${formatPromptVersion(version)}`,
  ].filter(Boolean);

  return parts.join(" · ");
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
  }

  return undefined;
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
