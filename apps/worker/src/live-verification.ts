export type LiveDispatchEvidence = {
  task?: {
    id?: unknown;
    planeId?: unknown;
    repo?: unknown;
    state?: unknown;
  };
  run?: {
    id?: unknown;
    status?: unknown;
    role?: unknown;
    attempt?: unknown;
    promptReleaseId?: unknown;
    workspacePath?: unknown;
    conversationId?: unknown;
    conversationUrl?: unknown;
    langfuseTraceId?: unknown;
    langfuseTraceUrl?: unknown;
    nextState?: unknown;
    summary?: unknown;
    error?: unknown;
  };
  verification?: {
    runDetailPath?: unknown;
    planeEvidence?: unknown;
    openHandsEvidence?: unknown;
    langfuseEvidence?: unknown;
    expectedNextState?: unknown;
  };
};

export type LiveDispatchVerification = {
  ok: boolean;
  errors: string[];
};

export function validateLiveDispatchEvidence(input: unknown): LiveDispatchVerification {
  const errors: string[] = [];
  const evidence = isRecord(input) ? (input as LiveDispatchEvidence) : undefined;

  if (!evidence) {
    return { ok: false, errors: ["Evidence must be a JSON object."] };
  }

  requireString(errors, evidence.task?.id, "task.id");
  requireString(errors, evidence.task?.planeId, "task.planeId");
  requireString(errors, evidence.task?.repo, "task.repo");
  requireString(errors, evidence.run?.id, "run.id");
  requireString(errors, evidence.run?.status, "run.status");
  requireString(errors, evidence.run?.role, "run.role");
  requirePositiveNumber(errors, evidence.run?.attempt, "run.attempt");
  requireString(errors, evidence.run?.promptReleaseId, "run.promptReleaseId");
  requireString(errors, evidence.run?.workspacePath, "run.workspacePath");
  requireString(errors, evidence.verification?.runDetailPath, "verification.runDetailPath");
  requireString(errors, evidence.verification?.planeEvidence, "verification.planeEvidence");
  requireString(errors, evidence.verification?.openHandsEvidence, "verification.openHandsEvidence");
  requireString(errors, evidence.verification?.langfuseEvidence, "verification.langfuseEvidence");

  const runDetailPath = evidence.verification?.runDetailPath;
  const runId = evidence.run?.id;
  if (
    typeof runDetailPath === "string" &&
    typeof runId === "string" &&
    runDetailPath !== `/runs/${runId}`
  ) {
    errors.push("verification.runDetailPath must point at the emitted run.id.");
  }

  const status = evidence.run?.status;
  if (status === "succeeded") {
    requireString(errors, evidence.run?.nextState, "run.nextState");
    requireString(
      errors,
      evidence.verification?.expectedNextState,
      "verification.expectedNextState",
    );
    requireString(errors, evidence.run?.summary, "run.summary");
  } else if (status === "failed" || status === "blocked") {
    requireString(errors, evidence.run?.error ?? evidence.run?.summary, "run.error or run.summary");
  } else {
    errors.push("run.status must be succeeded, failed, or blocked for one-shot live verification.");
  }

  return { ok: errors.length === 0, errors };
}

export function parseLiveDispatchEvidence(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("No live dispatch output was provided.");
  }

  return JSON.parse(trimmed);
}

function requireString(errors: string[], value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} is required.`);
  }
}

function requirePositiveNumber(errors: string[], value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${path} must be a positive number.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const isCli = process.argv[1]?.endsWith("live-verification.ts");
if (isCli) {
  try {
    const evidence = parseLiveDispatchEvidence(await readStdin());
    const result = validateLiveDispatchEvidence(evidence);
    if (!result.ok) {
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
