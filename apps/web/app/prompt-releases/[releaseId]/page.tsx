import { getPromptReleaseDetail, withDatabasePool } from "@agent-control-plane/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    releaseId: string;
  }>;
}

export default async function PromptReleaseDetailPage({ params }: PageProps) {
  const { releaseId } = await params;
  const release = await withDatabasePool((pool) => getPromptReleaseDetail(pool, releaseId));

  if (!release) {
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
            <h1>Prompt Release {shortId(release.id)}</h1>
            <p className="subtle">
              {release.taskIdentifier} · {release.repositorySlug} · {release.roleKey}
            </p>
          </div>
          <span className="badge ready">{release.components.length} components</span>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>上下文</h2>
            <div className="kv">
              <span>任务</span>
              <strong>{release.taskTitle}</strong>
              <span>仓库</span>
              <strong>{release.repositorySlug}</strong>
              <span>角色</span>
              <strong>{release.roleKey}</strong>
              <span>Agent</span>
              <strong>{release.agentName}</strong>
            </div>
          </article>

          <article className="panel wide">
            <h2>Hash</h2>
            <p className="hash">{release.contentHash}</p>
            <p className="subtle">创建于 {formatDate(release.createdAt)}</p>
          </article>

          <article className="panel wide">
            <h2>Components</h2>
            <div className="list">
              {release.components.map((component) => (
                <div className="component" key={component.promptComponentId}>
                  <div className="row">
                    <div>
                      <h3>
                        {component.orderIndex}. {component.scope}: {component.name} v
                        {component.version}
                      </h3>
                      <p className="subtle">{component.contentHash.slice(0, 24)}</p>
                    </div>
                  </div>
                  <pre>{component.content}</pre>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <h2>关联 Runs</h2>
            <div className="list">
              {release.runs.length > 0 ? (
                release.runs.map((run) => (
                  <Link className="row link-row" href={`/runs/${run.runId}`} key={run.runId}>
                    <div>
                      <h3>{shortId(run.runId)}</h3>
                      <p className="subtle">
                        {run.status} · attempt {run.attempt}
                      </p>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="subtle">暂无关联 run。</p>
              )}
            </div>
          </article>

          <article className="panel full">
            <h2>Rendered Prompt</h2>
            <pre>{release.renderedContent}</pre>
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
