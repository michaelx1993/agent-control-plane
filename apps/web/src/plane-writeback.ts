import type { WorkflowState } from "@agent-control-plane/core";
import type { PlaneConfig } from "@agent-control-plane/plane";
import { loadPlaneConfig, writePlaneTaskStateChange } from "@agent-control-plane/plane";

export interface PlaneTaskStateWritebackRequest {
  externalTaskId: string;
  nextState: WorkflowState;
  status: string;
  summary: string;
}

export interface PlaneTaskStateWritebackResult {
  attempted: boolean;
  ok: boolean;
  error?: string;
}

export async function maybeWritePlaneTaskState(
  input: PlaneTaskStateWritebackRequest,
  dependencies: {
    loadConfig?: () => PlaneConfig;
    writeStateChange?: typeof writePlaneTaskStateChange;
  } = {},
): Promise<PlaneTaskStateWritebackResult> {
  if (process.env.PLANE_WRITEBACK_ENABLED !== "true") {
    return {
      attempted: false,
      ok: true,
    };
  }

  try {
    const loadConfig = dependencies.loadConfig ?? loadPlaneConfig;
    const writeStateChange = dependencies.writeStateChange ?? writePlaneTaskStateChange;
    await writeStateChange(loadConfig(), input);
    return {
      attempted: true,
      ok: true,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
