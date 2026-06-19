import { fileURLToPath } from "node:url";

import {
  HttpPlaneClient,
  createPlaneLabelResolver,
  normalizePlaneTask,
  type PlaneClient,
  type PlaneLabelResolver,
} from "@agent-control-plane/plane";

export type PlaneProbeStatus = "pass" | "fail" | "skip";

export type PlaneProbeStep = {
  id: string;
  label: string;
  status: PlaneProbeStatus;
  detail: string;
};

export type PlaneProbeReport = {
  status: "ready" | "not_ready";
  checkedAt: string;
  mutating: boolean;
  steps: PlaneProbeStep[];
};

export type PlaneProbeOptions = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  client?: PlaneClient;
  now?: () => Date;
};

export async function runPlaneProbe(options: PlaneProbeOptions = {}): Promise<PlaneProbeReport> {
  const env = options.env ?? process.env;
  const mutating = env.PLANE_PROBE_MUTATE === "true";
  const steps: PlaneProbeStep[] = [];
  const missing = requiredEnv.filter((key) => !env[key]?.trim());

  if (missing.length > 0 && !options.client) {
    steps.push({
      id: "config",
      label: "Plane probe configuration",
      status: "fail",
      detail: `Missing required env: ${missing.join(", ")}.`,
    });
    return report(steps, mutating, options.now);
  }

  const client =
    options.client ??
    new HttpPlaneClient({
      baseUrl: env.PLANE_BASE_URL ?? "",
      apiKey: env.PLANE_API_KEY,
      apiKeyHeader: env.PLANE_API_KEY_HEADER ?? "X-API-Key",
      workspaceSlug: env.PLANE_WORKSPACE_SLUG,
      projectId: env.PLANE_PROJECT_ID,
      fetch: options.fetch ?? fetch,
    });

  const perPage = boundedPerPage(env.PLANE_PROBE_PER_PAGE ?? env.PLANE_SYNC_PER_PAGE);
  let firstTaskId = env.PLANE_PROBE_TASK_ID?.trim();
  const labelResolver = await loadLabelResolver(client, steps);

  try {
    const page = await client.listTaskPage({ perPage });
    steps.push({
      id: "list",
      label: "List work items",
      status: "pass",
      detail: `Plane returned ${page.results.length} work item(s); nextCursor=${page.nextCursor ?? "none"}.`,
    });

    const normalized = page.results.map((task) => normalizePlaneTask(task, { labelResolver }));
    const missingRepo = normalized.filter((task) => !task.repo).length;
    steps.push({
      id: "repo",
      label: "Repo field parsing",
      status: missingRepo > 0 ? "fail" : "pass",
      detail:
        normalized.length === 0
          ? "No work items returned; repo parsing could not be proven."
          : `${normalized.length - missingRepo}/${normalized.length} returned work item(s) have repo routing.`,
    });

    firstTaskId ??=
      page.results[0]?.id ?? page.results[0]?.issue_id ?? page.results[0]?.work_item_id;
  } catch (error) {
    steps.push({
      id: "list",
      label: "List work items",
      status: "fail",
      detail: errorDetail(error),
    });
    return report(steps, mutating, options.now);
  }

  if (!firstTaskId) {
    steps.push({
      id: "task",
      label: "Probe work item",
      status: "skip",
      detail: "PLANE_PROBE_TASK_ID is not set and list returned no task.",
    });
    return report(steps, mutating, options.now);
  }

  try {
    const task = await client.getTask(firstTaskId);
    const normalized = normalizePlaneTask(task, { labelResolver });
    steps.push({
      id: "get",
      label: "Get work item",
      status: "pass",
      detail: `Loaded ${normalized.identifier ?? normalized.sourceId}; repo=${normalized.repo ?? "missing"}.`,
    });
  } catch (error) {
    steps.push({
      id: "get",
      label: "Get work item",
      status: "fail",
      detail: errorDetail(error),
    });
    return report(steps, mutating, options.now);
  }

  if (!mutating) {
    steps.push({
      id: "mutations",
      label: "Mutation probes",
      status: "skip",
      detail:
        "Set PLANE_PROBE_MUTATE=true to run PATCH/comment probes against PLANE_PROBE_TASK_ID.",
    });
    return report(steps, mutating, options.now);
  }

  const patchJson = env.PLANE_PROBE_PATCH_JSON?.trim();
  if (patchJson) {
    try {
      await client.updateTask(firstTaskId, parsePatchJson(patchJson));
      steps.push({
        id: "patch",
        label: "Patch work item",
        status: "pass",
        detail: "PATCH work item succeeded.",
      });
    } catch (error) {
      steps.push({
        id: "patch",
        label: "Patch work item",
        status: "fail",
        detail: errorDetail(error),
      });
    }
  } else {
    steps.push({
      id: "patch",
      label: "Patch work item",
      status: "skip",
      detail: "PLANE_PROBE_PATCH_JSON is not set.",
    });
  }

  try {
    const body =
      env.PLANE_PROBE_COMMENT_BODY?.trim() ??
      `Agent Control Plane probe at ${(options.now?.() ?? new Date()).toISOString()}`;
    await client.addComment(firstTaskId, body);
    steps.push({
      id: "comment",
      label: "Comment work item",
      status: "pass",
      detail: "Comment API succeeded.",
    });
  } catch (error) {
    steps.push({
      id: "comment",
      label: "Comment work item",
      status: "fail",
      detail: errorDetail(error),
    });
  }

  return report(steps, mutating, options.now);
}

const requiredEnv = ["PLANE_BASE_URL", "PLANE_WORKSPACE_SLUG", "PLANE_PROJECT_ID"] as const;

async function loadLabelResolver(
  client: PlaneClient,
  steps: PlaneProbeStep[],
): Promise<PlaneLabelResolver | undefined> {
  if (!client.listLabels) return undefined;

  try {
    const labels = await client.listLabels();
    steps.push({
      id: "labels",
      label: "List project labels",
      status: "pass",
      detail: `Plane returned ${labels.length} project label(s) for ID resolution.`,
    });
    return createPlaneLabelResolver(labels);
  } catch (error) {
    steps.push({
      id: "labels",
      label: "List project labels",
      status: "fail",
      detail: errorDetail(error),
    });
    return undefined;
  }
}

function boundedPerPage(value?: string): number {
  const parsed = Number(value ?? 5);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(Math.floor(parsed), 100);
}

function parsePatchJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("PLANE_PROBE_PATCH_JSON must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function report(
  steps: PlaneProbeStep[],
  mutating: boolean,
  now: PlaneProbeOptions["now"],
): PlaneProbeReport {
  return {
    status: steps.some((step) => step.status === "fail") ? "not_ready" : "ready",
    checkedAt: (now?.() ?? new Date()).toISOString(),
    mutating,
    steps,
  };
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  runPlaneProbe()
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
