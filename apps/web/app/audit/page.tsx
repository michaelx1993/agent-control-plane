import {
  getAuditEventSummary,
  listAuditEvents,
  withDatabasePool,
  type AuditEventFilters,
} from "@agent-control-plane/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface AuditPageProps {
  searchParams?: Promise<{
    entityType?: string;
    action?: string;
    actor?: string;
    createdAfter?: string;
    createdBefore?: string;
    limit?: string;
  }>;
}

export default async function AuditPage(props: AuditPageProps) {
  const searchParams = await props.searchParams;
  const filters = parseAuditFilters(searchParams);
  const { events, summary } = await withDatabasePool(async (pool) => {
    const [events, summary] = await Promise.all([
      listAuditEvents(pool, filters),
      getAuditEventSummary(pool, { ...filters, limit: 10 }),
    ]);

    return { events, summary };
  });

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="subtle">
              <Link href="/">Dashboard</Link> / Audit
            </p>
            <h1>审计视图</h1>
            <p className="subtle">按 actor、action、entity 和时间窗口追踪控制面变更。</p>
          </div>
          <Link className="button secondary" href="/settings">
            Project Settings
          </Link>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>事件总数</h2>
            <p className="metric">{summary.totalEvents}</p>
            <p className="subtle">当前筛选窗口内的 audit event。</p>
          </article>

          <article className="panel">
            <h2>Actor</h2>
            <p className="metric">{summary.uniqueActors}</p>
            <p className="subtle">当前窗口内出现过的唯一 actor。</p>
          </article>

          <article className="panel">
            <h2>时间范围</h2>
            <p className="subtle">首条：{formatDate(summary.firstEventAt)}</p>
            <p className="subtle">末条：{formatDate(summary.lastEventAt)}</p>
          </article>

          <article className="panel wide">
            <h2>筛选</h2>
            <form className="filters" action="/audit">
              <label>
                <span>Entity Type</span>
                <input
                  name="entityType"
                  placeholder="prompt_binding"
                  defaultValue={filters.entityType ?? ""}
                />
              </label>
              <label>
                <span>Action</span>
                <input
                  name="action"
                  placeholder="prompt_binding.approve"
                  defaultValue={filters.action ?? ""}
                />
              </label>
              <label>
                <span>Actor</span>
                <input name="actor" placeholder="operator" defaultValue={filters.actor ?? ""} />
              </label>
              <label>
                <span>After</span>
                <input
                  name="createdAfter"
                  type="datetime-local"
                  defaultValue={formatDateInput(filters.createdAfter)}
                />
              </label>
              <label>
                <span>Before</span>
                <input
                  name="createdBefore"
                  type="datetime-local"
                  defaultValue={formatDateInput(filters.createdBefore)}
                />
              </label>
              <label>
                <span>Limit</span>
                <input
                  name="limit"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={String(filters.limit ?? 50)}
                />
              </label>
              <button type="submit">筛选审计</button>
            </form>
          </article>

          <AuditCountPanel title="Top Actions" items={summary.actionCounts} />
          <AuditCountPanel title="Top Entities" items={summary.entityTypeCounts} />
          <AuditCountPanel title="Top Actors" items={summary.actorCounts} />

          <article className="panel full">
            <h2>最近事件</h2>
            <div className="list">
              {events.map((event) => (
                <div className="row" key={event.id}>
                  <div>
                    <h3>{event.action}</h3>
                    <p className="subtle">
                      {event.entityType} · {event.entityId}
                    </p>
                    <p className="subtle">
                      {event.message} · {event.actorName ?? "unknown"} ·{" "}
                      {event.createdAt.toISOString()}
                    </p>
                  </div>
                  <span className="badge">{event.status ?? "audit"}</span>
                </div>
              ))}
              {events.length === 0 ? <p className="subtle">暂无审计事件。</p> : null}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

function AuditCountPanel(props: { title: string; items: { key: string; count: number }[] }) {
  return (
    <article className="panel">
      <h2>{props.title}</h2>
      <div className="list compact-list">
        {props.items.map((item) => (
          <div className="row" key={item.key}>
            <span>{item.key}</span>
            <span className="badge">{item.count}</span>
          </div>
        ))}
        {props.items.length === 0 ? <p className="subtle">暂无数据。</p> : null}
      </div>
    </article>
  );
}

function parseAuditFilters(
  searchParams: Awaited<AuditPageProps["searchParams"]>,
): AuditEventFilters {
  const limit = Number.parseInt(searchParams?.limit ?? "", 10);
  const createdAfter = parseDate(searchParams?.createdAfter);
  const createdBefore = parseDate(searchParams?.createdBefore);

  return {
    ...(searchParams?.entityType?.trim() ? { entityType: searchParams.entityType.trim() } : {}),
    ...(searchParams?.action?.trim() ? { action: searchParams.action.trim() } : {}),
    ...(searchParams?.actor?.trim() ? { actor: searchParams.actor.trim() } : {}),
    ...(createdAfter ? { createdAfter } : {}),
    ...(createdBefore ? { createdBefore } : {}),
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
  };
}

function parseDate(value?: string): Date | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDate(value?: Date): string {
  return value ? value.toISOString() : "n/a";
}

function formatDateInput(value?: Date): string {
  return value ? value.toISOString().slice(0, 16) : "";
}
