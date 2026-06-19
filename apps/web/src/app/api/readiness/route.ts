import { NextResponse } from "next/server";

import { requireReadAuth } from "../../../lib/api-auth";
import { getSystemReadiness } from "../../../lib/control-plane-service";

export async function GET(request: Request = new Request("http://localhost/api/readiness")) {
  const unauthorized = requireReadAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await getSystemReadiness());
}
