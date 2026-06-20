import { randomUUID } from "node:crypto";
import { listOperatorRuns } from "./runs.js";
import { listOperatorTasks } from "./tasks.js";
import { withDatabasePool, type DatabaseClient } from "./client.js";

interface SeedContext {
  taskId: string;
  repositoryId: string;
  roleId: string;
  agentDefinitionId: string;
}

async function main() {
  await withDatabasePool(async (pool) => {
    const context = await loadSeedContext(pool);
    const runId = await insertSucceededRun(pool, context);

    const tasks = await listOperatorTasks(pool, {
      state: "Development",
      mode: "agent",
      repositorySlug: "crs-src",
      lease: "none",
      limit: 5,
    });
    const runs = await listOperatorRuns(pool, {
      status: "succeeded",
      repositorySlug: "crs-src",
      role: "development",
      taskIdentifier: "TOK-1",
      limit: 5,
    });

    if (!tasks.some((task) => task.identifier === "TOK-1")) {
      throw new Error("operator task query did not return seeded TOK-1 task");
    }
    if (!runs.some((run) => run.runId === runId)) {
      throw new Error("operator run query did not return seeded smoke run");
    }

    console.log("operator_query_smoke=passed");
    console.log(`task_identifier=${tasks[0]?.identifier ?? "missing"}`);
    console.log(`run_id=${runId}`);
    console.log(`task_count=${tasks.length}`);
    console.log(`run_count=${runs.length}`);
  });
}

async function loadSeedContext(pool: DatabaseClient): Promise<SeedContext> {
  const result = await pool.query<SeedContext>(
    `
      select
        tasks.id as "taskId",
        repositories.id as "repositoryId",
        roles.id as "roleId",
        agent_definitions.id as "agentDefinitionId"
      from tasks
      join repositories on repositories.id = tasks.repository_id
      join roles on roles.key = 'development'
      join agent_definitions on agent_definitions.role_id = roles.id
      where tasks.identifier = 'TOK-1'
        and repositories.slug = 'crs-src'
      limit 1
    `,
  );
  const context = result.rows[0];
  if (!context) {
    throw new Error("seed context not found for TOK-1/crs-src/development");
  }
  return context;
}

async function insertSucceededRun(pool: DatabaseClient, context: SeedContext): Promise<string> {
  const runId = randomUUID();
  await pool.query(
    `
      insert into runs (
        id,
        task_id,
        repository_id,
        role_id,
        agent_definition_id,
        status,
        lease_owner,
        attempt,
        started_at,
        finished_at,
        result_summary,
        next_state,
        created_at,
        updated_at
      )
      values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        $5::uuid,
        'succeeded',
        'operator-query-smoke',
        1,
        now() - interval '1 minute',
        now(),
        'Operator query smoke completed.',
        'Code Review',
        now(),
        now()
      )
    `,
    [runId, context.taskId, context.repositoryId, context.roleId, context.agentDefinitionId],
  );
  return runId;
}

main().catch((error: unknown) => {
  console.error("operator_query_smoke=failed");
  console.error(`error=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
