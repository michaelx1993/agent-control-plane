import { getRunDetail, withDatabasePool } from "@agent-control-plane/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    runId: string;
  }>;
}

export default async function RunDetailPage({ params }: PageProps) {
  const { runId } = await params;
  const run = await withDatabasePool((pool) => getRunDetail(pool, runId));

  if (!run) {
    notFound();
  }

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/">
              ← 控制台
            </Link>
            <h1>
              {run.taskIdentifier} · Run {shortId(run.runId)}
            </h1>
            <p className="subtle">
              {run.projectSlug} / {run.repositorySlug} · {run.role} · attempt {run.attempt}
            </p>
          </div>
          <span className={`badge ${run.status === "succeeded" ? "ready" : "warn"}`}>
            {run.status}
          </span>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>任务</h2>
            <div className="kv">
              <span>标题</span>
              <strong>{run.taskTitle}</strong>
              <span>项目</span>
              <strong>{run.projectName}</strong>
              <span>仓库</span>
              <strong>{run.repositorySlug}</strong>
              <span>分支</span>
              <strong>{run.repositoryDefaultBranch}</strong>
            </div>
          </article>

          <article className="panel">
            <h2>执行</h2>
            <div className="kv">
              <span>Agent</span>
              <strong>{run.agentName}</strong>
              <span>Model</span>
              <strong>{run.agentModel}</strong>
              <span>Lease</span>
              <strong>{run.leaseOwner ?? "无"}</strong>
              <span>Lease expires</span>
              <strong>{formatOptionalDate(run.leaseExpiresAt)}</strong>
              <span>Next</span>
              <strong>{run.nextState ?? "无"}</strong>
            </div>
          </article>

          <article className="panel">
            <h2>时间</h2>
            <div className="kv">
              <span>创建</span>
              <strong>{formatDate(run.createdAt)}</strong>
              <span>开始</span>
              <strong>{formatOptionalDate(run.startedAt)}</strong>
              <span>心跳</span>
              <strong>{formatOptionalDate(run.heartbeatAt)}</strong>
              <span>结束</span>
              <strong>{formatOptionalDate(run.finishedAt)}</strong>
            </div>
          </article>

          <article className="panel wide">
            <h2>结果</h2>
            <p className="body-text">{run.resultSummary ?? run.failureReason ?? "暂无结果。"}</p>
            {run.status === "failed" || run.status === "stalled" ? (
              <p className="subtle compact-meta">
                Retry 取决于 worker backoff 和 failed/stalled 事件；详见任务详情页的 retry 视图。
              </p>
            ) : null}
          </article>

          <article className="panel wide">
            <h2>Workspace</h2>
            {run.workspace ? (
              <div className="kv">
                <span>Strategy</span>
                <strong>{run.workspace.strategy}</strong>
                <span>Status</span>
                <strong>{run.workspace.status}</strong>
                <span>Path</span>
                <strong>{run.workspace.path}</strong>
                <span>Base</span>
                <strong>{run.workspace.baseRef ?? "无"}</strong>
                <span>Head</span>
                <strong>{run.workspace.headRef ?? "无"}</strong>
              </div>
            ) : (
              <p className="subtle">尚未准备 workspace。</p>
            )}
          </article>

          <article className="panel">
            <h2>Prompt Release</h2>
            {run.promptRelease ? (
              <Link className="detail-link" href={`/prompt-releases/${run.promptRelease.id}`}>
                <strong>{shortId(run.promptRelease.id)}</strong>
                <span>{run.promptRelease.contentHash.slice(0, 16)}</span>
              </Link>
            ) : (
              <p className="subtle">暂无 prompt release。</p>
            )}
          </article>

          <article className="panel wide">
            <h2>Runtime Snapshot</h2>
            {run.planeRuntimeSnapshot ? (
              <>
                <div className="kv">
                  <span>Snapshot</span>
                  <strong>{shortId(run.planeRuntimeSnapshot.id)}</strong>
                  <span>Hash</span>
                  <strong>{run.planeRuntimeSnapshot.snapshotHash.slice(0, 16)}</strong>
                  <span>Schema</span>
                  <strong>{run.planeRuntimeSnapshot.payload.schemaVersion}</strong>
                  <span>Created</span>
                  <strong>{formatDate(run.planeRuntimeSnapshot.createdAt)}</strong>
                </div>
                <div className="snapshot-grid">
                  <section>
                    <h3>Prompt stack</h3>
                    {run.planeRuntimeSnapshot.payload.prompts.length > 0 ? (
                      <ol className="stack-list">
                        {run.planeRuntimeSnapshot.payload.prompts.map((prompt, index) => (
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
                    {run.planeRuntimeSnapshot.payload.availableSecretKeys.length > 0 ? (
                      <div className="chip-list">
                        {run.planeRuntimeSnapshot.payload.availableSecretKeys.map((secretKey) => (
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
                  {formatPromptPreview(run.planeRuntimeSnapshot.payload.assembledPrompt)}
                </pre>
              </>
            ) : (
              <p className="subtle">尚未冻结 Plane runtime snapshot。</p>
            )}
          </article>

          <article className="panel">
            <h2>Conversation</h2>
            {run.conversation ? (
              <>
                <div className="kv">
                  <span>Provider</span>
                  <strong>{run.conversation.provider}</strong>
                  <span>Conversation</span>
                  <strong>{run.conversation.conversationId}</strong>
                  <span>Event log</span>
                  {isHttpUrl(run.conversation.eventLogUri) ? (
                    <a
                      className="inline-link"
                      href={run.conversation.eventLogUri}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {formatEventLogLinkLabel(run.conversation.provider)}
                    </a>
                  ) : (
                    <strong>{run.conversation.eventLogUri ?? "无"}</strong>
                  )}
                </div>
                {run.conversation.uiUrl ? (
                  <a
                    className="detail-link"
                    href={run.conversation.uiUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <strong>{formatConversationLinkLabel(run.conversation.provider)}</strong>
                    <span>{run.conversation.uiUrl}</span>
                  </a>
                ) : null}
              </>
            ) : (
              <p className="subtle">尚未写入 conversation ref。</p>
            )}
          </article>

          <article className="panel wide">
            <h2>Run Events</h2>
            <div className="timeline">
              {run.events.map((event) => (
                <div className="timeline-item" key={event.id}>
                  <div>
                    <h3>{event.eventType}</h3>
                    <p className="subtle">{event.message}</p>
                    {event.payload ? (
                      <pre className="inline-code">{formatPayload(event.payload)}</pre>
                    ) : null}
                  </div>
                  <span className="subtle">{formatDate(event.createdAt)}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <h2>Trace Refs</h2>
            <div className="list">
              {run.traces.length > 0 ? (
                run.traces.map((trace) =>
                  trace.uiUrl ? (
                    <a
                      className="row link-row"
                      href={trace.uiUrl}
                      key={trace.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <div>
                        <h3>{formatTraceTitle(trace)}</h3>
                        <p className="subtle">{trace.traceId ?? trace.id}</p>
                        <p className="subtle compact-meta">{formatTraceMeta(trace)}</p>
                      </div>
                      <span className="subtle">{formatTraceLinkLabel(trace.provider)}</span>
                    </a>
                  ) : (
                    <div className="row" key={trace.id}>
                      <div>
                        <h3>{formatTraceTitle(trace)}</h3>
                        <p className="subtle">{trace.traceId ?? trace.id}</p>
                        <p className="subtle compact-meta">{formatTraceMeta(trace)}</p>
                      </div>
                    </div>
                  ),
                )
              ) : (
                <p className="subtle">尚未写入 trace ref。</p>
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/Los_Angeles",
  }).format(value);
}

function formatOptionalDate(value?: Date): string {
  return value ? formatDate(value) : "无";
}

function formatPayload(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

function isHttpUrl(value?: string): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

export function formatConversationLinkLabel(provider: string): string {
  return `打开 ${formatConversationProviderName(provider)} conversation`;
}

export function formatEventLogLinkLabel(provider: string): string {
  return `打开 ${formatConversationProviderName(provider)} event log`;
}

export function formatTraceLinkLabel(provider: string): string {
  return `打开 ${formatTraceProviderName(provider)} trace`;
}

function formatConversationProviderName(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  if (normalized.startsWith("codex")) {
    return "Codex";
  }

  if (normalized.includes("openhands")) {
    return "OpenHands";
  }

  return "run";
}

function formatTraceProviderName(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  if (normalized.startsWith("codex")) {
    return "Codex";
  }

  if (normalized.includes("langfuse")) {
    return "Langfuse";
  }

  return "external";
}

function formatTraceTitle(trace: {
  provider: string;
  model?: string;
  generationId?: string;
}): string {
  return [
    trace.model ?? trace.provider,
    trace.generationId ? `generation ${shortId(trace.generationId)}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatTraceMeta(trace: {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: string;
  latencyMs?: number;
}): string {
  const parts = [
    trace.inputTokens !== undefined ? `input ${trace.inputTokens}` : undefined,
    trace.outputTokens !== undefined ? `output ${trace.outputTokens}` : undefined,
    trace.costUsd !== undefined ? `cost $${trace.costUsd}` : undefined,
    trace.latencyMs !== undefined ? `${trace.latencyMs}ms` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "无 token/cost 摘要";
}
