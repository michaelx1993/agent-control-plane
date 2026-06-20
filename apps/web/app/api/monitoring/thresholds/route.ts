import {
  getMonitoringThresholds,
  updateMonitoringThresholds,
  withDatabasePool,
  withTransaction,
  type MonitoringThresholds,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";
import {
  canManageMonitoringSettings,
  getOperatorContext,
  monitoringSettingsPermissionMessage,
} from "../../../../src/operator";

export async function GET() {
  const thresholds = await withDatabasePool((pool) => getMonitoringThresholds(pool));

  return NextResponse.json({ thresholds });
}

export async function PUT(request: Request) {
  const operator = getOperatorContext();
  if (!canManageMonitoringSettings(operator)) {
    return NextResponse.json({ error: monitoringSettingsPermissionMessage() }, { status: 403 });
  }

  const payload = await request.json();
  let input: MonitoringThresholds;
  try {
    input = parseMonitoringThresholdsPayload(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
  const thresholds = await withDatabasePool((pool) =>
    withTransaction(pool, (client) =>
      updateMonitoringThresholds(client, { ...input, actorName: operator.name }),
    ),
  );

  return NextResponse.json({ thresholds });
}

function parseMonitoringThresholdsPayload(payload: unknown): MonitoringThresholds {
  if (!payload || typeof payload !== "object") {
    throw new Error("Monitoring thresholds payload is required.");
  }

  const record = payload as Record<string, unknown>;
  return {
    queueBacklogWarning: requiredNonNegativeInteger(record, "queueBacklogWarning"),
    stalledRunsCritical: requiredNonNegativeInteger(record, "stalledRunsCritical"),
    retryBacklogWarning: requiredNonNegativeInteger(record, "retryBacklogWarning"),
    failureRateCritical: requiredRatio(record, "failureRateCritical"),
    failureRateMinFinished: requiredNonNegativeInteger(record, "failureRateMinFinished"),
    costWarningUsd: requiredNonNegativeNumber(record, "costWarningUsd"),
    retryBackoffMs: requiredNonNegativeInteger(record, "retryBackoffMs"),
  };
}

function requiredNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = Number(record[key]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer.`);
  }

  return Math.trunc(value);
}

function requiredNonNegativeNumber(record: Record<string, unknown>, key: string): number {
  const value = Number(record[key]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number.`);
  }

  return value;
}

function requiredRatio(record: Record<string, unknown>, key: string): number {
  const value = Number(record[key]);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${key} must be between 0 and 1.`);
  }

  return value;
}
