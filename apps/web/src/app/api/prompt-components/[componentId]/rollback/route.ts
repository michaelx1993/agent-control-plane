import { NextResponse } from "next/server";

import {
  rollbackPromptComponent,
  type RollbackPromptComponentInput,
} from "../../../../../lib/control-plane-service";

type RouteContext = {
  params: Promise<{
    componentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { componentId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as Partial<RollbackPromptComponentInput>;

  try {
    const component = await rollbackPromptComponent(componentId, {
      author: stringOrNull(payload.author),
      changelog: stringOrNull(payload.changelog),
    });
    return NextResponse.json(component, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("DATABASE_URL")
      ? 503
      : message.includes("not found")
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
