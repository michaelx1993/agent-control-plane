import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
    planeStateEvidence?: unknown;
    planeCommentEvidence?: unknown;
    openHandsEvidence?: unknown;
    langfuseEvidence?: unknown;
    expectedNextState?: unknown;
  };
};

export type LiveDispatchVerification = {
  ok: boolean;
  errors: string[];
};

export type LiveDispatchEvidenceArchive = {
  capturedAt: string;
  evidence: unknown;
  verification: LiveDispatchVerification;
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
  requireString(errors, evidence.task?.state, "task.state");
  requireString(errors, evidence.run?.id, "run.id");
  requireString(errors, evidence.run?.status, "run.status");
  requireString(errors, evidence.run?.role, "run.role");
  requirePositiveNumber(errors, evidence.run?.attempt, "run.attempt");
  requireString(errors, evidence.run?.promptReleaseId, "run.promptReleaseId");
  requireString(errors, evidence.run?.workspacePath, "run.workspacePath");
  requireString(errors, evidence.verification?.runDetailPath, "verification.runDetailPath");
  requireString(errors, evidence.verification?.planeEvidence, "verification.planeEvidence");

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
    requireString(errors, evidence.run?.conversationId, "run.conversationId");
    requireUrl(errors, evidence.run?.conversationUrl, "run.conversationUrl");
    requireString(errors, evidence.run?.langfuseTraceId, "run.langfuseTraceId");
    requireUrl(errors, evidence.run?.langfuseTraceUrl, "run.langfuseTraceUrl");
    requireString(
      errors,
      evidence.verification?.planeStateEvidence,
      "verification.planeStateEvidence",
    );
    requireString(
      errors,
      evidence.verification?.planeCommentEvidence,
      "verification.planeCommentEvidence",
    );
    requireUrl(errors, evidence.verification?.openHandsEvidence, "verification.openHandsEvidence");
    requireUrl(errors, evidence.verification?.langfuseEvidence, "verification.langfuseEvidence");
    requireString(errors, evidence.run?.nextState, "run.nextState");
    requireString(
      errors,
      evidence.verification?.expectedNextState,
      "verification.expectedNextState",
    );
    requireString(errors, evidence.run?.summary, "run.summary");
    requireMatchingString(
      errors,
      evidence.task?.state,
      evidence.run?.nextState,
      "task.state",
      "run.nextState",
    );
    requireMatchingString(
      errors,
      evidence.verification?.expectedNextState,
      evidence.task?.state,
      "verification.expectedNextState",
      "task.state",
    );
    requireMatchingString(
      errors,
      evidence.verification?.planeStateEvidence,
      evidence.run?.nextState,
      "verification.planeStateEvidence",
      "run.nextState",
    );
    requireMatchingString(
      errors,
      evidence.verification?.openHandsEvidence,
      evidence.run?.conversationUrl,
      "verification.openHandsEvidence",
      "run.conversationUrl",
    );
    requireMatchingString(
      errors,
      evidence.verification?.langfuseEvidence,
      evidence.run?.langfuseTraceUrl,
      "verification.langfuseEvidence",
      "run.langfuseTraceUrl",
    );
  } else if (status === "failed" || status === "blocked") {
    requireString(errors, evidence.run?.error ?? evidence.run?.summary, "run.error or run.summary");
    requireString(
      errors,
      evidence.run?.conversationId ?? evidence.verification?.openHandsEvidence,
      "run.conversationId or verification.openHandsEvidence",
    );
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

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstJson = trimmed.indexOf("{");
    const lastJson = trimmed.lastIndexOf("}");
    if (firstJson === -1 || lastJson === -1 || lastJson <= firstJson) {
      throw new Error("Live dispatch output did not contain a JSON evidence object.");
    }

    return JSON.parse(trimmed.slice(firstJson, lastJson + 1));
  }
}

export async function writeLiveDispatchEvidenceArchive(
  path: string,
  evidence: unknown,
  verification: LiveDispatchVerification,
  now: Date = new Date(),
): Promise<LiveDispatchEvidenceArchive> {
  const archive: LiveDispatchEvidenceArchive = {
    capturedAt: now.toISOString(),
    evidence,
    verification,
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  return archive;
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

function requireUrl(errors: string[], value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} is required.`);
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push(`${path} must be an http(s) URL.`);
    }
  } catch {
    errors.push(`${path} must be an http(s) URL.`);
  }
}

function requireMatchingString(
  errors: string[],
  left: unknown,
  right: unknown,
  leftPath: string,
  rightPath: string,
): void {
  if (typeof left === "string" && typeof right === "string" && left !== right) {
    errors.push(`${leftPath} must match ${rightPath}.`);
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
    const writePath = readWritePath(process.argv.slice(2));
    const evidence = parseLiveDispatchEvidence(await readStdin());
    const result = validateLiveDispatchEvidence(evidence);
    if (!result.ok) {
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
    } else {
      if (writePath) {
        await writeLiveDispatchEvidenceArchive(writePath, evidence, result);
      }
      console.log(JSON.stringify({ ...result, evidencePath: writePath }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function readWritePath(args: string[]): string | undefined {
  const index = args.indexOf("--write");
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--write requires an output file path.");
  }
  return value;
}
