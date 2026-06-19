import { NextResponse } from "next/server";

import { requireReadAuth } from "../../../lib/api-auth";
import { getTaskQueue } from "../../../lib/control-plane-service";

export async function GET(request: Request = new Request("http://localhost/api/tasks")) {
  const unauthorized = requireReadAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  return NextResponse.json(
    await getTaskQueue({
      project: url.searchParams.get("project") ?? undefined,
      repo: url.searchParams.get("repo") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      team: url.searchParams.get("team") ?? undefined,
    }),
  );
}
