import { NextResponse } from "next/server";

import { requireOperatorAuth } from "../../../../../lib/api-auth";
import {
  resolveFeedbackItem,
  type ResolveFeedbackInput,
} from "../../../../../lib/control-plane-service";

type RouteContext = {
  params: Promise<{
    feedbackId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const unauthorized = requireOperatorAuth(request);
  if (unauthorized) return unauthorized;

  const { feedbackId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as Partial<ResolveFeedbackInput>;

  try {
    const result = await resolveFeedbackItem(feedbackId, {
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
    });
    return NextResponse.json(result);
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
