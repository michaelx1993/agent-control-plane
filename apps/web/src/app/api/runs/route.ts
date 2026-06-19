import { NextResponse } from "next/server";

import { requireReadAuth } from "../../../lib/api-auth";
import { getRuns } from "../../../lib/control-plane-service";

export async function GET(request: Request = new Request("http://localhost/api/runs")) {
  const unauthorized = requireReadAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await getRuns());
}
