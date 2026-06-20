import { NextResponse, type NextRequest } from "next/server";
import {
  isRouteFailure,
  optionalNonNegativeNumber,
  optionalPositiveInteger,
  optionalString,
  parseJsonObject,
  requireWorkerRequest,
} from "../../../../../../src/worker-api";
import { claimWorkerRuns } from "../../../../../../src/worker-claim";

export async function POST(request: NextRequest) {
  const worker = requireWorkerRequest(request);
  if (isRouteFailure(worker)) {
    return worker.response;
  }

  const payload = await parseJsonObject(request);
  const leaseTtlMs = optionalPositiveInteger(payload, "leaseTtlMs");
  const maxRuns = optionalPositiveInteger(payload, "maxRuns");
  const retryBackoffMs = optionalPositiveInteger(payload, "retryBackoffMs");
  const stalledAfterMs = optionalPositiveInteger(payload, "stalledAfterMs");
  const repositoryConcurrencyLimit = optionalPositiveInteger(payload, "repositoryConcurrencyLimit");
  const roleConcurrencyLimit = optionalPositiveInteger(payload, "roleConcurrencyLimit");
  const agentConcurrencyLimit = optionalPositiveInteger(payload, "agentConcurrencyLimit");
  const maxEstimatedCostUsdPerRun = optionalNonNegativeNumber(payload, "maxEstimatedCostUsdPerRun");
  const executionAdapter = optionalString(payload, "executionAdapter");
  const result = await claimWorkerRuns({
    workerId: worker.workerId,
    ...(leaseTtlMs ? { leaseTtlMs } : {}),
    ...(maxRuns ? { maxRuns } : {}),
    ...(retryBackoffMs ? { retryBackoffMs } : {}),
    ...(stalledAfterMs ? { stalledAfterMs } : {}),
    ...(repositoryConcurrencyLimit ? { repositoryConcurrencyLimit } : {}),
    ...(roleConcurrencyLimit ? { roleConcurrencyLimit } : {}),
    ...(agentConcurrencyLimit ? { agentConcurrencyLimit } : {}),
    ...(maxEstimatedCostUsdPerRun !== undefined ? { maxEstimatedCostUsdPerRun } : {}),
    ...(executionAdapter ? { executionAdapter } : {}),
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
