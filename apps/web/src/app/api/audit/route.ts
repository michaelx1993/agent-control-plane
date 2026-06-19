import { NextResponse } from "next/server";

import { requireReadAuth } from "../../../lib/api-auth";
import { getAuditLog } from "../../../lib/control-plane-service";

export async function GET(request: Request = new Request("http://localhost/api/audit")) {
  const unauthorized = requireReadAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const auditLog = await getAuditLog({
    action: url.searchParams.get("action") ?? undefined,
    entityType: url.searchParams.get("entityType") ?? undefined,
    retentionDays: numberParam(url.searchParams.get("retentionDays")),
  });

  if (url.searchParams.get("format") === "csv") {
    return new NextResponse(auditLogToCsv(auditLog.auditLog), {
      headers: {
        "content-disposition": "attachment; filename=agent-control-plane-audit-log.csv",
        "content-type": "text/csv; charset=utf-8",
      },
    });
  }

  return NextResponse.json(auditLog);
}

type AuditLogRow = Awaited<ReturnType<typeof getAuditLog>>["auditLog"][number];

function numberParam(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function auditLogToCsv(events: AuditLogRow[]): string {
  const header = ["createdAt", "action", "actor", "entityType", "entityId", "message", "payload"];
  const rows = events.map((event) => [
    event.createdAt,
    event.action,
    event.actor,
    event.entityType,
    event.entityId,
    event.message,
    JSON.stringify(event.payload ?? {}),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
