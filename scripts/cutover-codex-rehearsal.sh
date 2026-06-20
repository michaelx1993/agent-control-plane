#!/usr/bin/env bash
set -euo pipefail

PORTS_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-codex-rehearsal-ports.XXXXXX")"
AUDIT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-codex-rehearsal-audit.XXXXXX")"
SECRET_PROVIDER_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-codex-rehearsal-secrets.XXXXXX")"
REPORT_FILE="${ACP_CUTOVER_CODEX_REHEARSAL_REPORT_FILE:-}"
REPORT_FILE_IS_TEMP="false"
CUTOVER_OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-codex-rehearsal-output.XXXXXX")"
MOCK_PID=""
TEMP_DATABASE_NAME=""
TEMP_DATABASE_URL=""

cleanup() {
  if [[ -n "$MOCK_PID" ]]; then
    kill "$MOCK_PID" >/dev/null 2>&1 || true
    wait "$MOCK_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$TEMP_DATABASE_NAME" && -n "$TEMP_DATABASE_URL" ]]; then
    drop_temp_database "$TEMP_DATABASE_URL" "$TEMP_DATABASE_NAME" >/dev/null 2>&1 || true
  fi
  if [[ "$REPORT_FILE_IS_TEMP" == "true" && -n "$REPORT_FILE" ]]; then
    rm -f "$REPORT_FILE"
  fi
  rm -f "$PORTS_FILE" "$AUDIT_FILE" "$SECRET_PROVIDER_FILE" "$CUTOVER_OUTPUT_FILE"
}
trap cleanup EXIT

create_temp_database() {
  pnpm --filter @agent-control-plane/db exec node - "$1" "$2" <<'NODE'
import { Client } from "pg";

const [rawUrl, databaseName] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error(`Unsafe database name: ${databaseName}`);
}

const adminUrl = new URL(rawUrl);
adminUrl.pathname = "/postgres";
const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  await client.query(`create database ${databaseName}`);
} finally {
  await client.end();
}
NODE
}

drop_temp_database() {
  pnpm --filter @agent-control-plane/db exec node - "$1" "$2" <<'NODE'
import { Client } from "pg";

const [rawUrl, databaseName] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error(`Unsafe database name: ${databaseName}`);
}

const adminUrl = new URL(rawUrl);
adminUrl.pathname = "/postgres";
const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  await client.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1", [
    databaseName,
  ]);
  await client.query(`drop database if exists ${databaseName}`);
} finally {
  await client.end();
}
NODE
}

seed_task_source_sample() {
  pnpm --filter @agent-control-plane/db exec node - "$1" <<'NODE'
import { Client } from "pg";

const [planeBaseUrl] = process.argv.slice(2);
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const taskId = "00000000-0000-4000-8000-000000019101";
  const runId = "00000000-0000-4000-8000-000000019201";
  const projectId = "00000000-0000-4000-8000-000000000101";
  const repositoryId = "00000000-0000-4000-8000-000000000201";
  const roleId = "00000000-0000-4000-8000-000000000302";
  const agentDefinitionId = "00000000-0000-4000-8000-000000000403";
  const taskUrl = `${planeBaseUrl.replace(/\/$/, "")}/workspace/workspace/projects/token/issues/plane-codex-rehearsal`;

  await client.query(
    `
      update tasks
      set state = 'Backlog', updated_at = now()
      where project_id = $1
        and state in ('Todo', 'Development', 'Code Review', 'In Merge', 'Release Version', 'Deployment')
    `,
    [projectId],
  );

  await client.query(
    `
      insert into tasks (
        id, project_id, repository_id, external_task_id, identifier, title, state, priority,
        labels, url, last_synced_at, sync_cursor, created_at, updated_at
      )
      values (
        $1, $2, $3, 'plane-codex-rehearsal', 'TOK-CODEX-REHEARSAL',
        'Codex-first cutover rehearsal sample', 'Development', 2,
        '["repo:crs-src","smoke","codex"]'::jsonb, $4, now(),
        '2026-06-20T12:00:00.000Z', now(), now()
      )
      on conflict (project_id, external_task_id) do update set
        repository_id = excluded.repository_id,
        state = excluded.state,
        labels = excluded.labels,
        url = excluded.url,
        updated_at = now()
    `,
    [taskId, projectId, repositoryId, taskUrl],
  );

  await client.query(
    `
      insert into runs (
        id, task_id, repository_id, role_id, agent_definition_id, status, attempt,
        started_at, finished_at, result_summary, next_state, token_input, token_output,
        token_total, cost_usd, created_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5, 'succeeded', 1, now() - interval '2 minutes',
        now() - interval '1 minute', 'Codex-first cutover rehearsal run evidence.',
        'Code Review', 100, 40, 140, 0.010000, now() - interval '2 minutes',
        now() - interval '1 minute'
      )
      on conflict (id) do update set
        status = excluded.status,
        finished_at = excluded.finished_at,
        result_summary = excluded.result_summary,
        next_state = excluded.next_state,
        updated_at = now()
    `,
    [runId, taskId, repositoryId, roleId, agentDefinitionId],
  );

  await client.query(
    `
      insert into run_events (id, run_id, event_type, message, payload, created_at)
      values (
        '00000000-0000-4000-8000-000000019302', $1, 'codex.agent_message',
        'Codex-first rehearsal produced run event evidence.',
        '{"source":"cutover-codex-rehearsal"}'::jsonb, now()
      )
      on conflict (id) do update set
        event_type = excluded.event_type,
        message = excluded.message,
        payload = excluded.payload,
        created_at = excluded.created_at
    `,
    [runId],
  );

  await client.query(
    `
      insert into feedback_items (id, task_id, run_id, source, severity, body, created_at)
      values (
        '00000000-0000-4000-8000-000000019303', $1, $2, 'agent_progress',
        'info', 'Codex-first rehearsal Progress / Workpad evidence.', now()
      )
      on conflict (id) do update set
        run_id = excluded.run_id,
        source = excluded.source,
        severity = excluded.severity,
        body = excluded.body,
        created_at = excluded.created_at
    `,
    [taskId, runId],
  );
} finally {
  await client.end();
}
NODE
}

node - <<'NODE' >"$AUDIT_FILE"
console.log(
  JSON.stringify({
    type: "secret_rotation",
    created_at: new Date().toISOString(),
    actor: "cutover-codex-rehearsal",
    target: "agent-control-plane",
  }),
);
NODE
chmod 600 "$AUDIT_FILE"

node - "$PORTS_FILE" <<'NODE' &
const http = require("node:http");
const fs = require("node:fs");
const portsFile = process.argv[2];

const state = {
  plane: {
    states: [{ id: "state-development", name: "Development" }],
    item: { id: "issue-1", state: "state-todo", name: "Codex cutover rehearsal work item" },
    comments: [],
  },
};

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
  });
}

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const plane = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname.endsWith("/states/") && request.method === "GET") {
    send(response, 200, state.plane.states);
    return;
  }
  if (url.pathname.endsWith("/work-items/issue-1/") && request.method === "PATCH") {
    const body = JSON.parse((await readBody(request)) || "{}");
    state.plane.item = { ...state.plane.item, state: body.state ?? state.plane.item.state };
    send(response, 200, state.plane.item);
    return;
  }
  if (url.pathname.endsWith("/work-items/issue-1/") && request.method === "GET") {
    send(response, 200, state.plane.item);
    return;
  }
  if (url.pathname.endsWith("/work-items/issue-1/comments/") && request.method === "POST") {
    const body = JSON.parse((await readBody(request)) || "{}");
    state.plane.comments.push({
      id: `comment-${state.plane.comments.length + 1}`,
      comment_html: body.comment_html ?? "",
      comment_stripped: String(body.comment_html ?? "").replace(/<[^>]+>/g, ""),
    });
    send(response, 200, state.plane.comments.at(-1));
    return;
  }
  if (url.pathname.endsWith("/work-items/issue-1/comments/") && request.method === "GET") {
    send(response, 200, state.plane.comments);
    return;
  }
  send(response, 404, { error: "not_found", path: url.pathname });
});

plane.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portsFile, JSON.stringify({ plane: plane.address().port }));
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
NODE
MOCK_PID="$!"

for _ in {1..50}; do
  if [[ -s "$PORTS_FILE" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -s "$PORTS_FILE" ]]; then
  echo "cutover_codex_rehearsal=failed" >&2
  echo "error=mock_services_not_ready" >&2
  exit 1
fi

PLANE_PORT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).plane))' "$PORTS_FILE")"
PLANE_BASE_URL_REHEARSAL="http://127.0.0.1:${PLANE_PORT}"
REHEARSAL_ADAPTER="${WORKER_EXECUTION_ADAPTER:-${ACP_CUTOVER_CODEX_REHEARSAL_ADAPTER:-codex-cli}}"

if [[ "$REHEARSAL_ADAPTER" != "codex-cli" && "$REHEARSAL_ADAPTER" != "codex-app-server" ]]; then
  echo "cutover_codex_rehearsal=failed" >&2
  echo "error=WORKER_EXECUTION_ADAPTER must be codex-cli or codex-app-server" >&2
  exit 1
fi

echo "cutover_codex_rehearsal=running"
echo "mock_plane=${PLANE_BASE_URL_REHEARSAL}"
echo "worker_execution_adapter=${REHEARSAL_ADAPTER}"

CUTOVER_DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
if [[ "${ACP_CUTOVER_CODEX_REHEARSAL_TEMP_DB:-true}" != "false" ]]; then
  TEMP_DATABASE_NAME="acp_codex_rehearsal_$(date +%s)_$$"
  TEMP_DATABASE_URL="$(node -e 'const url = new URL(process.argv[1]); url.pathname = "/" + process.argv[2]; process.stdout.write(url.toString());' "$CUTOVER_DATABASE_URL" "$TEMP_DATABASE_NAME")"
  echo "temp_database=${TEMP_DATABASE_NAME}"
  create_temp_database "$CUTOVER_DATABASE_URL" "$TEMP_DATABASE_NAME"
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:migrate
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:seed
  CUTOVER_DATABASE_URL="$TEMP_DATABASE_URL"
fi

DATABASE_URL="$CUTOVER_DATABASE_URL" seed_task_source_sample "$PLANE_BASE_URL_REHEARSAL"

cat >"$SECRET_PROVIDER_FILE" <<EOF_SECRET_PROVIDER
DATABASE_URL=${CUTOVER_DATABASE_URL}
ACP_OPERATOR_API_TOKEN=rehearsal-operator-token-000000000000000000000000
ACP_OPERATOR_LOGIN_PASSWORD=rehearsal-login-password-000000000000000000000
ACP_OPERATOR_SESSION_SECRET=rehearsal-session-secret-000000000000000000000
PLANE_WEBHOOK_SECRET=rehearsal-plane-webhook-secret-000000000000000
PLANE_WRITEBACK_ENABLED=true
PLANE_BASE_URL=${PLANE_BASE_URL_REHEARSAL}
PLANE_WORKSPACE_SLUG=workspace
PLANE_PROJECT_ID=project
PLANE_API_KEY=rehearsal-plane-api-key-000000000000000000000
ACP_COMPLETION_EXECUTION_PROFILE=codex-cli
WORKER_EXECUTION_ADAPTER=${REHEARSAL_ADAPTER}
EOF_SECRET_PROVIDER
chmod 600 "$SECRET_PROVIDER_FILE"

if [[ -z "$REPORT_FILE" ]]; then
  REPORT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-codex-rehearsal-report.XXXXXX")"
  rm -f "$REPORT_FILE"
  REPORT_FILE_IS_TEMP="true"
fi

DATABASE_URL="$CUTOVER_DATABASE_URL" \
PLANE_BASE_URL="$PLANE_BASE_URL_REHEARSAL" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="rehearsal-plane-key" \
PLANE_WEBHOOK_SECRET="rehearsal-webhook-secret" \
PLANE_WRITEBACK_ENABLED="true" \
PLANE_WRITEBACK_SMOKE_APPLY="true" \
PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
PLANE_WRITEBACK_SMOKE_NEXT_STATE="Development" \
PLANE_WRITEBACK_SMOKE_STATUS="Codex Rehearsal" \
PLANE_WRITEBACK_SMOKE_SUMMARY="Agent Control Plane Codex-first cutover rehearsal writeback." \
ACP_OPERATOR_API_TOKEN="rehearsal-operator-token" \
ACP_COMPLETION_EXECUTION_PROFILE="codex-cli" \
ACP_CUTOVER_ALLOW_LOOPBACK_URLS="true" \
ACP_CUTOVER_SKIP_SECRET_VALIDATE="true" \
ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="cutover-codex-rehearsal mock: legacy Linear/Symphony poller disabled $(date -u +%Y-%m-%d)" \
ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="cutover-codex-rehearsal mock: Linear archive-only confirmed $(date -u +%Y-%m-%d)" \
ACP_CUTOVER_MANUAL_EVIDENCE_SUMMARY="cutover-codex-rehearsal mock evidence" \
ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true" \
ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="true" \
ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true" \
ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true" \
ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true" \
ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true" \
ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true" \
ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true" \
TASK_SOURCE_SMOKE_PROJECT_SLUG="token" \
ACP_CUTOVER_REPORT_FILE="$REPORT_FILE" \
ACP_SECRET_COMMAND="cat '$SECRET_PROVIDER_FILE'" \
SECRET_PROVIDER_AUDIT_FILE="$AUDIT_FILE" \
WORKER_EXECUTION_ADAPTER="$REHEARSAL_ADAPTER" \
pnpm --silent cutover:check >"$CUTOVER_OUTPUT_FILE"

if [[ "$REPORT_FILE_IS_TEMP" == "true" ]]; then
  grep -v '^cutover_report_file=' "$CUTOVER_OUTPUT_FILE" || true
else
  cat "$CUTOVER_OUTPUT_FILE"
fi

node - "$REPORT_FILE" "$REHEARSAL_ADAPTER" <<'NODE'
const fs = require("node:fs");

const [reportFile, expectedAdapter] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(report.readiness === "passed", "cutover report readiness must be passed");
assert(report.config?.completionExecutionProfile === "codex-cli", "completion profile must be codex-cli");
assert(report.config?.workerExecutionAdapter === expectedAdapter, "worker adapter must match rehearsal adapter");
assert(report.smoke.production === false, "production smoke should not run in local Codex rehearsal");
assert(report.smoke.externalPreflight === false, "external preflight should not run in local Codex rehearsal");
assert(report.smoke.planeWriteback === true, "plane writeback smoke must be recorded");
assert(report.smoke.codexAdapter === true, "codex adapter smoke must be recorded");
assert(report.smoke.taskSource === true, "task-source smoke must be recorded");
assert(report.smoke.workerCrashRecovery === true, "worker crash recovery smoke must be recorded");
assert(report.smoke.workerBudget === true, "worker budget smoke must be recorded");
assert(report.smoke.workerWorkflow === true, "worker workflow smoke must be recorded");
assert(report.smoke.secretProvider === true, "secret provider smoke must be recorded");
assert(report.smoke.secretProviderAudit === true, "secret provider audit smoke must be recorded");
assert(report.smoke.openhandsConversation === false, "OpenHands conversation smoke must not run in Codex rehearsal");
assert(report.smoke.openhandsAdapter === false, "OpenHands adapter smoke must not run in Codex rehearsal");
assert(report.smoke.openhandsDbRun === false, "OpenHands DB smoke must not run in Codex rehearsal");
assert(report.smoke.langfuseTrace === false, "Langfuse smoke must not run in Codex rehearsal");
assert(
  typeof report.evidence.planeWriteback === "string" &&
    report.evidence.planeWriteback.includes("comment=created") &&
    report.evidence.planeWriteback.includes("verified=true"),
  "Plane writeback evidence missing from report",
);
assert(
  typeof report.evidence.codexAdapter === "string" &&
    report.evidence.codexAdapter.includes(`provider=${expectedAdapter}`) &&
    report.evidence.codexAdapter.includes("next_state=Code Review"),
  "Codex adapter evidence missing from report",
);
assert(
  typeof report.evidence.taskSource === "string" &&
    report.evidence.taskSource.includes("checked=1") &&
    report.evidence.taskSource.includes("linear_urls=0") &&
    report.evidence.taskSource.includes("run_events=1") &&
    report.evidence.taskSource.includes("progress_items=1"),
  "Codex task-source evidence missing from report",
);
assert(
  typeof report.evidence.workerCrashRecovery === "string" &&
    report.evidence.workerCrashRecovery.includes("recovered_attempt=2"),
  "worker crash recovery evidence missing from report",
);
assert(
  typeof report.evidence.workerBudget === "string" &&
    report.evidence.workerBudget.includes("budget_blocked=1") &&
    report.evidence.workerBudget.includes("final_state=Blocked"),
  "worker budget evidence missing from report",
);
assert(
  typeof report.evidence.workerWorkflow === "string" &&
    report.evidence.workerWorkflow.includes("final_state=Done"),
  "worker workflow evidence missing from report",
);
assert(
  typeof report.evidence.secretProvider === "string" &&
    report.evidence.secretProvider.includes("variables=") &&
    report.evidence.secretProvider.includes("validation=passed"),
  "secret provider evidence missing from report",
);
assert(
  typeof report.evidence.secretProviderAudit === "string" &&
    report.evidence.secretProviderAudit.includes("source=file") &&
    report.evidence.secretProviderAudit.includes("matched_events=1"),
  "secret provider audit evidence missing from report",
);
assert(report.evidence.externalPreflight === "not-run", "external preflight evidence should be not-run");
NODE

COMPLETION_AUDIT_OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-codex-rehearsal-completion-audit.XXXXXX")"
set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$REPORT_FILE" \
  node scripts/completion-audit.mjs >"$COMPLETION_AUDIT_OUTPUT_FILE" 2>&1
COMPLETION_AUDIT_STATUS=$?
set -e

if [[ "$COMPLETION_AUDIT_STATUS" -eq 0 ]]; then
  echo "cutover_codex_rehearsal=failed" >&2
  echo "error=completion_audit_unexpectedly_accepted_codex_rehearsal_report" >&2
  cat "$COMPLETION_AUDIT_OUTPUT_FILE" >&2
  rm -f "$COMPLETION_AUDIT_OUTPUT_FILE"
  exit 1
fi

if ! grep -q "completion_audit_status=incomplete" "$COMPLETION_AUDIT_OUTPUT_FILE"; then
  echo "cutover_codex_rehearsal=failed" >&2
  echo "error=completion_audit_did_not_report_incomplete_codex_rehearsal" >&2
  cat "$COMPLETION_AUDIT_OUTPUT_FILE" >&2
  rm -f "$COMPLETION_AUDIT_OUTPUT_FILE"
  exit 1
fi
rm -f "$COMPLETION_AUDIT_OUTPUT_FILE"

echo "completion_audit_rejects_codex_rehearsal=true"

if [[ "$REPORT_FILE_IS_TEMP" != "true" ]]; then
  echo "cutover_codex_rehearsal_report_file=${REPORT_FILE}"
fi

echo "cutover_codex_rehearsal=passed"
