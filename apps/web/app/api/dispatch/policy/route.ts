import {
  getDispatchPolicy,
  updateDispatchPolicy,
  withDatabasePool,
  withTransaction,
  type DispatchPolicy,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";
import {
  canManageProjectSettings,
  getOperatorContext,
  projectSettingsPermissionMessage,
} from "../../../../src/operator";

export async function GET() {
  const policy = await withDatabasePool((pool) => getDispatchPolicy(pool));

  return NextResponse.json({ policy });
}

export async function PUT(request: Request) {
  const operator = getOperatorContext();
  if (!canManageProjectSettings(operator)) {
    return NextResponse.json({ error: projectSettingsPermissionMessage() }, { status: 403 });
  }

  const payload = await request.json();
  let input: DispatchPolicy;
  try {
    input = parseDispatchPolicyPayload(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  const policy = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      updateDispatchPolicy(client, { ...input, actorName: operator.name }),
    ),
  );

  return NextResponse.json({ policy });
}

function parseDispatchPolicyPayload(payload: unknown): DispatchPolicy {
  if (!payload || typeof payload !== "object") {
    throw new Error("Dispatch policy payload is required.");
  }

  const record = payload as Record<string, unknown>;
  const rawValue = record.maxEstimatedCostUsdPerRun;
  const queuePriorityPolicy = parseQueuePriorityPolicy(record.queuePriorityPolicy);
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { queuePriorityPolicy };
  }

  const maxEstimatedCostUsdPerRun = Number(rawValue);
  if (!Number.isFinite(maxEstimatedCostUsdPerRun) || maxEstimatedCostUsdPerRun < 0) {
    throw new Error("maxEstimatedCostUsdPerRun must be a non-negative number.");
  }

  return {
    maxEstimatedCostUsdPerRun,
    queuePriorityPolicy,
  };
}

function parseQueuePriorityPolicy(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "priority_first";
  }

  if (
    value === "priority_first" ||
    value === "priority_aging" ||
    value === "repo_fair" ||
    value === "weighted_priority" ||
    value === "oldest_first" ||
    value === "newest_first"
  ) {
    return value;
  }

  throw new Error(
    "queuePriorityPolicy must be priority_first, priority_aging, repo_fair, weighted_priority, oldest_first, or newest_first.",
  );
}
