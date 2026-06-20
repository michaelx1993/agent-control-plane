import {
  createPromptComponentVersion,
  listPromptComponents,
  withDatabasePool,
  withTransaction,
  type PromptComponentStatus,
} from "@agent-control-plane/db";
import { type PromptScope } from "@agent-control-plane/core";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    scope?: string;
    status?: string;
  }>;
}

const scopes = ["global", "team", "project", "repo", "role", "agent"] as const;
const statuses = ["draft", "active", "archived"] as const;

export default async function PromptComponentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const scope = parseScope(params.scope);
  const status = parseStatus(params.status);
  const components = await withDatabasePool((pool) =>
    listPromptComponents(pool, {
      ...(scope ? { scope } : {}),
      ...(status ? { status } : {}),
      limit: 200,
    }),
  );

  async function createAction(formData: FormData) {
    "use server";
    const input = parseCreateForm(formData);
    const component = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => createPromptComponentVersion(client, input)),
    );

    redirect(`/prompt-components/${component.id}`);
  }

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/">
              ← 控制台
            </Link>
            <h1>Prompt Manager</h1>
            <p className="subtle">管理 global / team / project / repo / role / agent prompt。</p>
          </div>
          <span className="badge">{components.length} components</span>
        </header>

        <section className="panel full">
          <form className="filters">
            <label>
              <span>Scope</span>
              <select name="scope" defaultValue={scope ?? ""}>
                <option value="">全部</option>
                {scopes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
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
            <button type="submit">筛选</button>
          </form>
        </section>

        <section className="grid">
          <article className="panel wide">
            <h2>Prompt Components</h2>
            <div className="table-list">
              {components.length > 0 ? (
                components.map((component) => (
                  <Link
                    className="task-row"
                    href={`/prompt-components/${component.id}`}
                    key={component.id}
                  >
                    <div>
                      <h2>
                        {component.scope} · {component.name} v{component.version}
                      </h2>
                      <p className="subtle">
                        {component.scopeId ?? "global"} · {component.contentHash.slice(0, 12)}
                      </p>
                    </div>
                    <div className="task-meta">
                      <span className={`badge ${component.status === "active" ? "ready" : ""}`}>
                        {component.status}
                      </span>
                      <span className="badge">{component.boundCount} bindings</span>
                    </div>
                    <div>
                      <p className="subtle">Author</p>
                      <strong>{component.author ?? "无"}</strong>
                    </div>
                    <div>
                      <p className="subtle">Updated</p>
                      <strong>{formatDate(component.updatedAt)}</strong>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="subtle">没有匹配 prompt component。</p>
              )}
            </div>
          </article>

          <article className="panel">
            <h2>新建 Component</h2>
            <form action={createAction} className="action-form">
              <select name="scope" defaultValue="team">
                {scopes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <input name="scopeId" placeholder="scope id，global 可留空" />
              <input name="name" placeholder="名称" required />
              <select name="status" defaultValue="draft">
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <input name="author" placeholder="作者" />
              <input name="changelog" placeholder="变更说明" />
              <textarea name="content" placeholder="Prompt 内容" rows={12} required />
              <button type="submit">创建</button>
            </form>
          </article>
        </section>
      </div>
    </main>
  );
}

function parseCreateForm(formData: FormData) {
  const scope = parseScope(String(formData.get("scope") ?? ""));
  const status = parseStatus(String(formData.get("status") ?? ""));
  const name = String(formData.get("name") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const scopeId = String(formData.get("scopeId") ?? "").trim();
  const author = String(formData.get("author") ?? "").trim();
  const changelog = String(formData.get("changelog") ?? "").trim();

  if (!scope || !status || !name || !content) {
    throw new Error("scope, status, name and content are required");
  }

  return {
    scope,
    status,
    name,
    content,
    ...(scopeId ? { scopeId } : {}),
    ...(author ? { author } : {}),
    ...(changelog ? { changelog } : {}),
  };
}

function parseScope(value?: string): PromptScope | undefined {
  return value && scopes.includes(value as PromptScope) ? (value as PromptScope) : undefined;
}

function parseStatus(value?: string): PromptComponentStatus | undefined {
  return value && statuses.includes(value as PromptComponentStatus)
    ? (value as PromptComponentStatus)
    : undefined;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(value);
}
