import { fileURLToPath } from "node:url";

import { HttpPlaneClient } from "@agent-control-plane/plane";

export type PreflightStatus = "pass" | "fail" | "skip";

export type PreflightCheck = {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
  durationMs?: number;
};

export type PreflightReport = {
  status: "ready" | "not_ready";
  checkedAt: string;
  checks: PreflightCheck[];
};

export type LivePreflightOptions = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  db?: {
    $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
    $disconnect?(): Promise<void>;
  };
};

type DatabaseBaselineRow = {
  teams?: bigint | number | string | null;
  repositories?: bigint | number | string | null;
  roles?: bigint | number | string | null;
  agents?: bigint | number | string | null;
};

type DatabaseBaselineCounts = {
  teams: number;
  repositories: number;
  roles: number;
  agents: number;
};

type RequiredEnv = {
  id: string;
  label: string;
};

const requiredEnv: RequiredEnv[] = [
  { id: "DATABASE_URL", label: "PostgreSQL connection string" },
  { id: "PLANE_BASE_URL", label: "Plane API base URL" },
  { id: "PLANE_WORKSPACE_SLUG", label: "Plane workspace slug" },
  { id: "PLANE_PROJECT_ID", label: "Plane project id" },
  { id: "OPENHANDS_BASE_URL", label: "OpenHands API base URL" },
  { id: "LANGFUSE_BASE_URL", label: "Langfuse API base URL" },
  { id: "LANGFUSE_PUBLIC_KEY", label: "Langfuse public key" },
  { id: "LANGFUSE_SECRET_KEY", label: "Langfuse secret key" },
];

const databaseBaselineQuery = `
SELECT
  (SELECT COUNT(*) FROM teams) AS teams,
  (SELECT COUNT(*) FROM repositories WHERE status = 'active') AS repositories,
  (SELECT COUNT(*) FROM roles) AS roles,
  (SELECT COUNT(*) FROM agent_definitions WHERE status = 'active') AS agents
`;

export async function runLivePreflight(
  options: LivePreflightOptions = {},
): Promise<PreflightReport> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const checks: PreflightCheck[] = [];

  checks.push(...checkRequiredEnv(env));
  checks.push(await checkDatabase(options.db, env));
  checks.push(await checkPlane(env, fetchImpl));
  checks.push(
    await checkHealthEndpoint({
      id: "openhands",
      label: "OpenHands health",
      baseUrl: env.OPENHANDS_BASE_URL,
      path: env.OPENHANDS_HEALTH_PATH ?? "/health",
      fetchImpl,
      headers: env.OPENHANDS_API_KEY ? { authorization: `Bearer ${env.OPENHANDS_API_KEY}` } : {},
      missingDetail: "OPENHANDS_BASE_URL is required.",
    }),
  );
  checks.push(
    await checkHealthEndpoint({
      id: "langfuse",
      label: "Langfuse health",
      baseUrl: env.LANGFUSE_BASE_URL,
      path: env.LANGFUSE_HEALTH_PATH ?? "/api/public/health",
      fetchImpl,
      headers:
        env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
          ? {
              authorization: `Basic ${Buffer.from(
                `${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`,
              ).toString("base64")}`,
            }
          : {},
      missingDetail: "LANGFUSE_BASE_URL is required.",
    }),
  );

  return {
    status: checks.some((check) => check.status === "fail") ? "not_ready" : "ready",
    checkedAt: new Date().toISOString(),
    checks,
  };
}

function checkRequiredEnv(env: NodeJS.ProcessEnv): PreflightCheck[] {
  return requiredEnv.map((item) => {
    const value = env[item.id];
    return {
      id: `env:${item.id}`,
      label: item.id,
      status: value && value.trim().length > 0 ? "pass" : "fail",
      detail: value && value.trim().length > 0 ? item.label : `${item.label} is missing.`,
    };
  });
}

async function checkDatabase(
  db: LivePreflightOptions["db"],
  env: NodeJS.ProcessEnv,
): Promise<PreflightCheck> {
  if (!env.DATABASE_URL) {
    return {
      id: "database",
      label: "Database connectivity",
      status: "skip",
      detail: "DATABASE_URL is missing.",
    };
  }

  const startedAt = Date.now();
  let ownedDb: LivePreflightOptions["db"];
  try {
    if (!db) {
      const { prisma } = await import("@agent-control-plane/db");
      ownedDb = prisma;
    }
    const client = db ?? ownedDb;
    await client?.$queryRawUnsafe("SELECT 1");
    const baselineRows =
      await client?.$queryRawUnsafe<DatabaseBaselineRow[]>(databaseBaselineQuery);
    const baseline = normalizeDatabaseBaseline(baselineRows?.[0]);
    const baselineDetail = formatDatabaseBaseline(baseline);
    if (Object.values(baseline).some((count) => count <= 0)) {
      return {
        id: "database",
        label: "Database connectivity",
        status: "fail",
        detail: `PostgreSQL responded, but Control Plane baseline is incomplete: ${baselineDetail}. Run database seed before live worker rollout.`,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      id: "database",
      label: "Database connectivity",
      status: "pass",
      detail: `PostgreSQL responded and Control Plane baseline is present: ${baselineDetail}.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: "database",
      label: "Database connectivity",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await ownedDb?.$disconnect?.();
  }
}

function normalizeDatabaseBaseline(row?: DatabaseBaselineRow): DatabaseBaselineCounts {
  return {
    teams: normalizeCount(row?.teams),
    repositories: normalizeCount(row?.repositories),
    roles: normalizeCount(row?.roles),
    agents: normalizeCount(row?.agents),
  };
}

function normalizeCount(value: bigint | number | string | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function formatDatabaseBaseline(baseline: DatabaseBaselineCounts): string {
  return `teams=${baseline.teams}, repositories=${baseline.repositories}, roles=${baseline.roles}, agents=${baseline.agents}`;
}

async function checkPlane(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<PreflightCheck> {
  if (!env.PLANE_BASE_URL || !env.PLANE_WORKSPACE_SLUG || !env.PLANE_PROJECT_ID) {
    return {
      id: "plane",
      label: "Plane work-items API",
      status: "skip",
      detail: "PLANE_BASE_URL, PLANE_WORKSPACE_SLUG, and PLANE_PROJECT_ID are required.",
    };
  }

  const startedAt = Date.now();
  try {
    const client = new HttpPlaneClient({
      baseUrl: env.PLANE_BASE_URL,
      apiKey: env.PLANE_API_KEY,
      apiKeyHeader: env.PLANE_API_KEY_HEADER ?? "X-API-Key",
      workspaceSlug: env.PLANE_WORKSPACE_SLUG,
      projectId: env.PLANE_PROJECT_ID,
      fetch: fetchImpl,
    });
    const tasks = await client.listTasks({ perPage: 1 });
    return {
      id: "plane",
      label: "Plane work-items API",
      status: "pass",
      detail: `Plane returned ${tasks.length} work item(s) for the configured project.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: "plane",
      label: "Plane work-items API",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function checkHealthEndpoint(input: {
  id: string;
  label: string;
  baseUrl?: string;
  path: string;
  fetchImpl: typeof fetch;
  headers?: Record<string, string>;
  missingDetail: string;
}): Promise<PreflightCheck> {
  if (!input.baseUrl) {
    return {
      id: input.id,
      label: input.label,
      status: "skip",
      detail: input.missingDetail,
    };
  }

  const startedAt = Date.now();
  const url = `${input.baseUrl.replace(/\/+$/, "")}/${input.path.replace(/^\/+/, "")}`;
  try {
    const response = await input.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        ...input.headers,
      },
    });
    if (!response.ok) {
      return {
        id: input.id,
        label: input.label,
        status: "fail",
        detail: `${url} returned ${response.status} ${response.statusText}`.trim(),
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      id: input.id,
      label: input.label,
      status: "pass",
      detail: `${url} responded successfully.`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function main() {
  const report = await runLivePreflight();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ready") {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
