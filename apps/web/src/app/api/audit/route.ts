import { NextResponse } from "next/server";

import { requireReadAuth } from "../../../lib/api-auth";
import { getAuditLog } from "../../../lib/control-plane-service";

export async function GET(request: Request = new Request("http://localhost/api/audit")) {
  const unauthorized = requireReadAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  return NextResponse.json(
    await getAuditLog({
      action: url.searchParams.get("action") ?? undefined,
      entityType: url.searchParams.get("entityType") ?? undefined,
    }),
  );
}
