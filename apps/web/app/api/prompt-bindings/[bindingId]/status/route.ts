import {
  updatePromptBindingStatus,
  withDatabasePool,
  withTransaction,
  type PromptBindingStatus,
} from "@agent-control-plane/db";
import {
  canApprovePromptBinding,
  getOperatorContext,
  promptBindingPermissionMessage,
} from "../../../../../src/operator";
import { NextResponse } from "next/server";

const statuses = ["pending", "active", "disabled", "rejected"] as const;

interface RouteContext {
  params: Promise<{
    bindingId: string;
  }>;
}

interface StatusBody {
  status?: unknown;
}

export async function POST(request: Request, context: RouteContext) {
  const operator = getOperatorContext();
  if (!canApprovePromptBinding(operator)) {
    return NextResponse.json(
      { error: promptBindingPermissionMessage("approve"), operator },
      { status: 403 },
    );
  }

  const { bindingId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as StatusBody;
  const status = typeof payload.status === "string" ? parseStatus(payload.status) : undefined;

  if (!status) {
    return NextResponse.json({ error: "Valid status is required" }, { status: 400 });
  }

  const result = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      updatePromptBindingStatus(client, bindingId, status, operator),
    ),
  );
  if (!result.updated) {
    return NextResponse.json(result, { status: result.reason === "binding_not_found" ? 404 : 409 });
  }

  return NextResponse.json(result);
}

function parseStatus(value: string): PromptBindingStatus | undefined {
  return statuses.includes(value as PromptBindingStatus)
    ? (value as PromptBindingStatus)
    : undefined;
}
