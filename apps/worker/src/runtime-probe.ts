import { fileURLToPath } from "node:url";

import {
  LangfuseHttpAdapter,
  tokenUsage,
  type LangfuseAdapter,
} from "@agent-control-plane/langfuse";
import { HttpOpenHandsAdapter, type OpenHandsAdapter } from "@agent-control-plane/openhands";

export type RuntimeProbeStatus = "pass" | "fail";

export type RuntimeProbeStep = {
  id: string;
  label: string;
  status: RuntimeProbeStatus;
  detail: string;
};

export type RuntimeProbeReport = {
  status: "ready" | "not_ready";
  checkedAt: string;
  mutating: boolean;
  steps: RuntimeProbeStep[];
};

export type RuntimeProbeOptions = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  openHands?: OpenHandsAdapter;
  langfuse?: LangfuseAdapter;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export async function runRuntimeProbe(
  options: RuntimeProbeOptions = {},
): Promise<RuntimeProbeReport> {
  const env = options.env ?? process.env;
  const steps: RuntimeProbeStep[] = [];
  const mutating = env.RUNTIME_PROBE_MUTATE === "true" || Boolean(options.openHands);
  const checkedAt = (options.now?.() ?? new Date()).toISOString();

  if (!mutating) {
    steps.push({
      id: "config",
      label: "Runtime probe mode",
      status: "fail",
      detail:
        "RUNTIME_PROBE_MUTATE=true is required because the runtime probe creates OpenHands and Langfuse records.",
    });
    return report(steps, checkedAt, mutating);
  }

  const missing = requiredEnv.filter((key) => !env[key]?.trim());
  if (missing.length > 0 && (!options.openHands || !options.langfuse)) {
    steps.push({
      id: "config",
      label: "Runtime probe configuration",
      status: "fail",
      detail: `Missing required env: ${missing.join(", ")}.`,
    });
    return report(steps, checkedAt, mutating);
  }

  const fetchImpl = options.fetch ?? fetch;
  const openHands =
    options.openHands ??
    new HttpOpenHandsAdapter({
      baseUrl: env.OPENHANDS_BASE_URL ?? "",
      headers: env.OPENHANDS_API_KEY ? { authorization: `Bearer ${env.OPENHANDS_API_KEY}` } : {},
      apiMode: env.OPENHANDS_API_MODE === "legacy" ? "legacy" : "v1",
      endpoints: {
        conversations: env.OPENHANDS_CONVERSATIONS_PATH,
        runs: env.OPENHANDS_RUNS_PATH,
      },
      fetch: fetchImpl,
    });
  const langfuse =
    options.langfuse ??
    new LangfuseHttpAdapter({
      baseUrl: env.LANGFUSE_BASE_URL ?? "",
      publicKey: env.LANGFUSE_PUBLIC_KEY ?? "",
      secretKey: env.LANGFUSE_SECRET_KEY ?? "",
      endpoints: {
        traces: env.LANGFUSE_TRACES_PATH,
        generations: env.LANGFUSE_GENERATIONS_PATH,
      },
      fetch: fetchImpl,
    });

  const probeId = `runtime-probe-${Date.parse(checkedAt) || Date.now()}`;
  const repo = env.RUNTIME_PROBE_REPO ?? "crs-src";
  let conversationId: string | undefined;
  let conversationUrl: string | undefined;

  try {
    const conversation = await openHands.createConversation({
      taskId: `${probeId}-task`,
      runId: `${probeId}-run`,
      repo,
      workspacePath: env.RUNTIME_PROBE_WORKSPACE_PATH,
      prompt:
        env.RUNTIME_PROBE_PROMPT ??
        "Runtime probe: respond with a concise completion summary without modifying files.",
      metadata: {
        source: "agent-control-plane-runtime-probe",
        repo,
      },
    });
    conversationId = conversation.id;
    conversationUrl = conversation.url;
    await openHands.startRun(conversation.id);
    steps.push({
      id: "openhands:start",
      label: "OpenHands conversation and run",
      status: "pass",
      detail: `Started conversation ${conversation.id}${conversation.url ? ` at ${conversation.url}` : ""}.`,
    });

    const result = await pollOpenHandsResult(openHands, conversation.id, env, options.sleep);
    if (!result) {
      steps.push({
        id: "openhands:result",
        label: "OpenHands terminal result",
        status: "fail",
        detail: `No terminal result after ${pollAttempts(env)} poll attempt(s).`,
      });
    } else {
      steps.push({
        id: "openhands:result",
        label: "OpenHands terminal result",
        status: result.status === "completed" ? "pass" : "fail",
        detail: `${result.status}: ${result.summary}`,
      });
    }
  } catch (error) {
    steps.push({
      id: "openhands:start",
      label: "OpenHands conversation and run",
      status: "fail",
      detail: errorDetail(error),
    });
  }

  try {
    const trace = await langfuse.startTrace({
      name: "agent-control-plane-runtime-probe",
      metadata: {
        taskId: `${probeId}-task`,
        runId: `${probeId}-run`,
        conversationId,
        repo,
        role: "Runtime Probe",
        model: env.RUNTIME_PROBE_MODEL ?? "gpt-5.5",
      },
    });
    await langfuse.recordGeneration({
      traceId: trace.traceId,
      name: "runtime-probe",
      model: env.RUNTIME_PROBE_MODEL ?? "gpt-5.5",
      input: { conversationId },
      output: { conversationUrl },
      usage: tokenUsage(0, 0),
    });
    const summary = await langfuse.finishTrace(trace.traceId, {
      conversationId,
      conversationUrl,
      status: "runtime_probe_completed",
    });
    steps.push({
      id: "langfuse:trace",
      label: "Langfuse trace lifecycle",
      status: "pass",
      detail: `Trace ${summary.trace.traceId}${summary.trace.url ? ` at ${summary.trace.url}` : ""}; generations=${summary.generationCount}.`,
    });
  } catch (error) {
    steps.push({
      id: "langfuse:trace",
      label: "Langfuse trace lifecycle",
      status: "fail",
      detail: errorDetail(error),
    });
  }

  return report(steps, checkedAt, mutating);
}

const requiredEnv = [
  "OPENHANDS_BASE_URL",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
] as const;

async function pollOpenHandsResult(
  openHands: OpenHandsAdapter,
  conversationId: string,
  env: NodeJS.ProcessEnv,
  sleepImpl: RuntimeProbeOptions["sleep"],
) {
  let cursor: string | undefined;
  for (let attempt = 0; attempt < pollAttempts(env); attempt += 1) {
    const page = await openHands.listEvents(conversationId, cursor);
    cursor = page.nextCursor ?? cursor;
    const result = await openHands.getResult(conversationId);
    if (result) return result;
    const interval = pollIntervalMs(env);
    if (interval > 0) {
      await (sleepImpl ?? sleep)(interval);
    }
  }
  return undefined;
}

function pollAttempts(env: NodeJS.ProcessEnv): number {
  return positiveInteger(env.RUNTIME_PROBE_OPENHANDS_POLL_ATTEMPTS, 10);
}

function pollIntervalMs(env: NodeJS.ProcessEnv): number {
  return positiveInteger(env.RUNTIME_PROBE_OPENHANDS_POLL_INTERVAL_MS, 1000);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function report(
  steps: RuntimeProbeStep[],
  checkedAt: string,
  mutating: boolean,
): RuntimeProbeReport {
  return {
    status: steps.some((step) => step.status === "fail") ? "not_ready" : "ready",
    checkedAt,
    mutating,
    steps,
  };
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  runRuntimeProbe()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "ready") {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(errorDetail(error));
      process.exitCode = 1;
    });
}
