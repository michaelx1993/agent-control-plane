import {
  getAuditEventSummary,
  listAuditEvents,
  withDatabasePool,
  type AuditEventFilters,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const filters = parseAuditFilters(url, limit);
  const { events, summary } = await withDatabasePool(async (pool) => {
    const [events, summary] = await Promise.all([
      listAuditEvents(pool, filters),
      getAuditEventSummary(pool, { ...filters, limit: 10 }),
    ]);

    return { events, summary };
  });

  return NextResponse.json({ events, summary });
}

function optionalParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function parseAuditFilters(url: URL, limit: number): AuditEventFilters {
  const entityType = optionalParam(url, "entityType");
  const action = optionalParam(url, "action");
  const actor = optionalParam(url, "actor");
  const createdAfter = optionalDateParam(url, "createdAfter");
  const createdBefore = optionalDateParam(url, "createdBefore");

  return {
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(actor ? { actor } : {}),
    ...(createdAfter ? { createdAfter } : {}),
    ...(createdBefore ? { createdBefore } : {}),
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
  };
}

function optionalDateParam(url: URL, key: string): Date | undefined {
  const value = optionalParam(url, key);
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
