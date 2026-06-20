import {
  activatePromptComponentVersion,
  archivePromptComponent,
  createPromptComponentVersion,
  diffPromptComponents,
  getPromptComponentDetail,
  getPromptComponentMetrics,
  withDatabasePool,
  withTransaction,
  type PromptComponentStatus,
} from "@agent-control-plane/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    componentId: string;
  }>;
}

const statuses = ["draft", "active", "archived"] as const;

export default async function PromptComponentDetailPage({ params }: PageProps) {
  const { componentId } = await params;
  const component = await withDatabasePool((pool) => getPromptComponentDetail(pool, componentId));

  if (!component) {
    notFound();
  }

  const metrics = await withDatabasePool((pool) => getPromptComponentMetrics(pool, componentId));
  const detail = component;
  const previousVersion = detail.versions.find((version) => version.id !== detail.id);
  const diff = previousVersion
    ? await withDatabasePool((pool) => diffPromptComponents(pool, previousVersion.id, detail.id))
    : undefined;

  async function activateAction() {
    "use server";
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => activatePromptComponentVersion(client, componentId)),
    );
    if (!result.updated) {
      throw new Error(`Activate failed: ${result.reason ?? "unknown"}`);
    }

    redirect(`/prompt-components/${componentId}`);
  }

  async function archiveAction() {
    "use server";
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => archivePromptComponent(client, componentId)),
    );
    if (!result.updated) {
      throw new Error(`Archive failed: ${result.reason ?? "unknown"}`);
    }

    redirect(`/prompt-components/${componentId}`);
  }

  async function createVersionAction(formData: FormData) {
    "use server";
    const content = String(formData.get("content") ?? "").trim();
    const status = parseStatus(String(formData.get("status") ?? ""));
    const author = String(formData.get("author") ?? "").trim();
    const changelog = String(formData.get("changelog") ?? "").trim();

    if (!content || !status) {
      throw new Error("content and status are required");
    }

    const next = await withDatabasePool((pool) =>
      withTransaction(pool, (client) =>
        createPromptComponentVersion(client, {
          scope: detail.scope,
          name: detail.name,
          content,
          status,
          ...(detail.scopeId ? { scopeId: detail.scopeId } : {}),
          ...(author ? { author } : {}),
          ...(changelog ? { changelog } : {}),
        }),
      ),
    );

    redirect(`/prompt-components/${next.id}`);
  }

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/prompt-components">
              ← Prompt Manager
            </Link>
            <h1>
              {detail.scope} · {detail.name} v{detail.version}
            </h1>
            <p className="subtle">
              {detail.scopeId ?? "global"} · {detail.contentHash}
            </p>
          </div>
          <span className={`badge ${detail.status === "active" ? "ready" : "warn"}`}>
            {detail.status}
          </span>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>元数据</h2>
            <div className="kv">
              <span>Scope</span>
              <strong>{detail.scope}</strong>
              <span>Scope ID</span>
              <strong>{detail.scopeId ?? "global"}</strong>
              <span>Bindings</span>
              <strong>{detail.boundCount}</strong>
              <span>Author</span>
              <strong>{detail.author ?? "无"}</strong>
              <span>Changelog</span>
              <strong>{detail.changelog ?? "无"}</strong>
            </div>
          </article>

          <article className="panel">
            <h2>操作</h2>
            <div className="action-form">
              <form action={activateAction}>
                <button type="submit">激活此版本</button>
              </form>
              <form action={archiveAction}>
                <button type="submit">归档此版本</button>
              </form>
            </div>
          </article>

          <article className="panel full">
            <h2>版本指标</h2>
            <div className="metrics-grid">
              <MetricCard label="Prompt Releases" value={metrics?.releaseCount ?? 0} />
              <MetricCard label="Runs" value={metrics?.runCount ?? 0} />
              <MetricCard
                label="成功率"
                value={`${Math.round((metrics?.successRate ?? 0) * 100)}%`}
              />
              <MetricCard label="Total Tokens" value={formatNumber(metrics?.tokenTotal ?? 0)} />
              <MetricCard label="Cost USD" value={formatUsd(metrics?.costUsd ?? 0)} />
              <MetricCard
                label="最近使用"
                value={metrics?.lastUsedAt ? formatDate(metrics.lastUsedAt) : "无"}
              />
            </div>
            <div className="table-list metric-run-list">
              {metrics?.recentRuns.length ? (
                metrics.recentRuns.map((run) => (
                  <Link
                    className="metric-run-row link-row"
                    href={`/runs/${run.runId}`}
                    key={run.runId}
                  >
                    <div>
                      <h3>{run.taskIdentifier}</h3>
                      <p className="subtle">
                        {run.repositorySlug} · {run.roleKey} · {formatDate(run.createdAt)}
                      </p>
                    </div>
                    <span className={`badge ${run.status === "succeeded" ? "ready" : "warn"}`}>
                      {run.status}
                    </span>
                    <span>{formatNumber(run.tokenTotal ?? 0)} tokens</span>
                    <span>{formatUsd(run.costUsd ?? 0)}</span>
                  </Link>
                ))
              ) : (
                <p className="subtle">此版本还没有被任何 run 使用。</p>
              )}
            </div>
          </article>

          <article className="panel wide">
            <h2>新建版本</h2>
            <form action={createVersionAction} className="action-form">
              <select name="status" defaultValue="draft">
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <input name="author" placeholder="作者" defaultValue={detail.author ?? ""} />
              <input name="changelog" placeholder="变更说明" />
              <textarea name="content" rows={16} defaultValue={detail.content} />
              <button type="submit">保存为新版本</button>
            </form>
          </article>

          <article className="panel wide">
            <h2>内容</h2>
            <pre>{detail.content}</pre>
          </article>

          <article className="panel">
            <h2>版本</h2>
            <div className="list">
              {detail.versions.map((version) => (
                <Link
                  className="row link-row"
                  href={`/prompt-components/${version.id}`}
                  key={version.id}
                >
                  <div>
                    <h3>v{version.version}</h3>
                    <p className="subtle">{version.contentHash.slice(0, 12)}</p>
                  </div>
                  <span className={`badge ${version.status === "active" ? "ready" : ""}`}>
                    {version.status}
                  </span>
                </Link>
              ))}
            </div>
          </article>

          <article className="panel full">
            <h2>Diff</h2>
            {diff ? (
              <div className="diff-list">
                {diff.lines.map((line, index) => (
                  <pre className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                    {prefixForDiff(line.type)}
                    {line.content}
                  </pre>
                ))}
              </div>
            ) : (
              <p className="subtle">没有可对比的上一版本。</p>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}

function parseStatus(value?: string): PromptComponentStatus | undefined {
  return value && statuses.includes(value as PromptComponentStatus)
    ? (value as PromptComponentStatus)
    : undefined;
}

function prefixForDiff(type: "unchanged" | "added" | "removed"): string {
  if (type === "added") {
    return "+ ";
  }

  if (type === "removed") {
    return "- ";
  }

  return "  ";
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Los_Angeles",
  }).format(date);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}
