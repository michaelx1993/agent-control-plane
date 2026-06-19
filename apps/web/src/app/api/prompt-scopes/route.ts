import { NextResponse } from "next/server";

import { requireReadAuth } from "../../../lib/api-auth";
import { getPromptScopes } from "../../../lib/control-plane-service";

export async function GET(request: Request = new Request("http://localhost/api/prompt-scopes")) {
  const unauthorized = requireReadAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await getPromptScopes());
}
