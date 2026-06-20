import {
  getDispatchPolicy,
  getProjectSettingsSnapshot,
  getMonitoringThresholds,
  listPromptBindings,
  withDatabasePool,
} from "@agent-control-plane/db";
import { NextResponse } from "next/server";

export async function GET() {
  const snapshot = await withDatabasePool(async (pool) => {
    const [settings, promptBindings, monitoringThresholds, dispatchPolicy] = await Promise.all([
      getProjectSettingsSnapshot(pool),
      listPromptBindings(pool),
      getMonitoringThresholds(pool),
      getDispatchPolicy(pool),
    ]);

    return {
      ...settings,
      promptBindings,
      monitoringThresholds,
      dispatchPolicy,
    };
  });

  return NextResponse.json(snapshot);
}
