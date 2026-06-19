import Link from "next/link";

import { getAuditLog } from "@/lib/control-plane-service";
import type { AuditLogItem } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

type AuditPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type AuditFilters = {
  action: string;
  entityType: string;
};

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const filters = normalizeAuditFilters(resolvedSearchParams);
  const [audit, auditOptions] = await Promise.all([
    getAuditLog({
      action: filters.action || undefined,
      entityType: filters.entityType || undefined,
    }),
    getAuditLog(),
  ]);
  const options = auditFilterOptions(auditOptions.auditLog);

  return (
    <main className="shell">
      <header className="topbar" aria-label="Audit log">
        <div>
          <Link className="backLink" href="/">
            Runtime Operations Console
          </Link>
          <p className="eyebrow">Audit Log</p>
          <h1>Operator Actions</h1>
        </div>
        <a className="buttonLink" href="/monitoring">
          Monitoring
        </a>
      </header>

      <section className="dashboardGrid" aria-label="Audit log sections">
        <section className="panel panelWide">
          <div className="panelHead">
            <h2>Audit Events</h2>
            <span>{audit.count} events</span>
          </div>
          <form className="queueFilters" aria-label="Audit log filters">
            <FilterSelect
              label="Action"
              name="action"
              options={options.actions}
              value={filters.action}
            />
            <FilterSelect
              label="Entity"
              name="entityType"
              options={options.entityTypes}
              value={filters.entityType}
            />
            <div className="queueFilterActions">
              <button className="primaryButton" type="submit">
                Apply
              </button>
              <a className="buttonLink" href="/audit">
                Clear
              </a>
            </div>
          </form>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                  <th>Message</th>
                  <th>Payload</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {audit.auditLog.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <span className="emptyText">No audit events match the selected filters.</span>
                    </td>
                  </tr>
                ) : (
                  audit.auditLog.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <strong>{event.action}</strong>
                      </td>
                      <td>
                        <strong>
                          <Link href={event.href}>{event.entityType}</Link>
                        </strong>
                        <span>{event.entityId}</span>
                      </td>
                      <td>{event.actor}</td>
                      <td>{event.message || "none"}</td>
                      <td>
                        <pre className="auditPayload">
                          {JSON.stringify(event.payload ?? {}, null, 2)}
                        </pre>
                      </td>
                      <td>{event.createdAt}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function normalizeAuditFilters(
  params: Record<string, string | string[] | undefined>,
): AuditFilters {
  return {
    action: firstParam(params.action),
    entityType: firstParam(params.entityType),
  };
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function auditFilterOptions(events: AuditLogItem[]) {
  return {
    actions: uniqueSorted(events.map((event) => event.action)),
    entityTypes: uniqueSorted(events.map((event) => event.entityType)),
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
  name: keyof AuditFilters;
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
