import { NextResponse } from "next/server";

import {
  createRunFeedback,
  type CreateRunFeedbackInput,
} from "../../../../../lib/control-plane-service";

const feedbackSources = new Set(["human", "code_review", "pr_review", "agent", "plane_comment"]);
const feedbackSeverities = new Set(["info", "minor", "major", "blocker"]);

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { runId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseCreateRunFeedbackInput(body);
  if (parsed instanceof Error) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  try {
    return NextResponse.json(await createRunFeedback(runId, parsed), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

function parseCreateRunFeedbackInput(body: unknown): CreateRunFeedbackInput | Error {
  if (!isRecord(body)) {
    return new Error("Body must be an object");
  }

  const text = stringField(body, "body");
  if (!text) {
    return new Error("body is required");
  }

  const source = optionalStringField(body, "source");
  if (source && !feedbackSources.has(source)) {
    return new Error("source must be human, code_review, pr_review, agent, or plane_comment");
  }

  const severity = optionalStringField(body, "severity");
  if (severity && !feedbackSeverities.has(severity)) {
    return new Error("severity must be info, minor, major, or blocker");
  }

  return {
    body: text,
    externalUrl: optionalStringField(body, "externalUrl") ?? null,
    returnToDevelopment: body.returnToDevelopment === true,
    severity: severity as CreateRunFeedbackInput["severity"],
    source: source as CreateRunFeedbackInput["source"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value.trim() : undefined;
}
