#!/usr/bin/env bash
set -euo pipefail

PORTS_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-rehearsal-ports.XXXXXX")"
AUDIT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-rehearsal-audit.XXXXXX")"
SECRET_PROVIDER_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-rehearsal-secrets.XXXXXX")"
OPENHANDS_PAYLOAD_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-rehearsal-openhands-payload.XXXXXX")"
REPORT_FILE="${ACP_CUTOVER_REHEARSAL_REPORT_FILE:-}"
REPORT_FILE_IS_TEMP="false"
CUTOVER_OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-rehearsal-output.XXXXXX")"
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
  rm -f "$PORTS_FILE" "$AUDIT_FILE" "$SECRET_PROVIDER_FILE" "$OPENHANDS_PAYLOAD_FILE" "$CUTOVER_OUTPUT_FILE"
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

cat >"$AUDIT_FILE" <<'EOF_AUDIT'
{"type":"secret_rotation","created_at":"2026-06-19T12:00:00.000Z","actor":"cutover-rehearsal","target":"agent-control-plane"}
EOF_AUDIT
chmod 600 "$AUDIT_FILE"

node - "$PORTS_FILE" <<'NODE' &
const http = require("node:http");
const fs = require("node:fs");
const portsFile = process.argv[2];

const state = {
  plane: {
    states: [{ id: "state-development", name: "Development" }],
    item: { id: "issue-1", state: "state-todo", name: "Cutover rehearsal work item" },
    comments: [],
  },
  openhands: {
    startTasks: new Map(),
    conversations: new Map(),
    sequence: 0,
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

function createPlaneServer() {
  return http.createServer(async (request, response) => {
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
}

function createOpenHandsServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/v1/app-conversations" && request.method === "GET") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      if (ids.includes("__acp_smoke_probe__")) {
        send(response, 200, []);
        return;
      }

      const conversations = ids
        .map((id) => state.openhands.conversations.get(id))
        .filter(Boolean);
      send(response, 200, conversations);
      return;
    }

    if (url.pathname === "/api/v1/app-conversations" && request.method === "POST") {
      await readBody(request);
      state.openhands.sequence += 1;
      const startTaskId = `start-${state.openhands.sequence}`;
      const conversationId = `conversation-${state.openhands.sequence}`;
      state.openhands.startTasks.set(startTaskId, {
        id: startTaskId,
        status: "READY",
        app_conversation_id: conversationId,
      });
      state.openhands.conversations.set(conversationId, {
        id: conversationId,
        sandbox_status: "READY",
        execution_status: "finished",
        event_log_url: `/api/v1/app-conversations/${conversationId}/events`,
        events: [
          {
            source: "agent",
            message: "Cutover rehearsal OpenHands mock completed.",
          },
          {
            source: "tool",
            tool_name: "shell",
            command: "true",
            exit_code: 0,
          },
        ],
      });
      send(response, 200, { id: startTaskId, status: "WORKING" });
      return;
    }

    const eventLogMatch = url.pathname.match(/^\/api\/v1\/app-conversations\/([^/]+)\/events$/);
    if (eventLogMatch && request.method === "GET") {
      const conversationId = decodeURIComponent(eventLogMatch[1]);
      if (!state.openhands.conversations.has(conversationId)) {
        send(response, 404, { error: "conversation_not_found" });
        return;
      }

      send(response, 200, {
        data: [
          {
            source: "agent",
            message: "Cutover rehearsal OpenHands event log captured.",
          },
          {
            source: "tool",
            tool_name: "shell",
            command: "true",
            exit_code: 0,
          },
        ],
      });
      return;
    }

    if (url.pathname === "/api/v1/app-conversations/start-tasks" && request.method === "GET") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      const tasks = ids.map((id) => state.openhands.startTasks.get(id)).filter(Boolean);
      send(response, 200, tasks);
      return;
    }

    send(response, 404, { error: "not_found", path: url.pathname });
  });
}

function createLangfuseServer() {
  return http.createServer(async (request, response) => {
    await readBody(request);
    if (request.url === "/api/public/health" && request.method === "GET") {
      send(response, 200, { status: "ok" });
      return;
    }

    send(response, 200, { id: "langfuse-rehearsal", status: "ok" });
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

(async () => {
  const plane = createPlaneServer();
  const openhands = createOpenHandsServer();
  const langfuse = createLangfuseServer();
  const [planePort, openhandsPort, langfusePort] = await Promise.all([
    listen(plane),
    listen(openhands),
    listen(langfuse),
  ]);
  fs.writeFileSync(
    portsFile,
    JSON.stringify({
      plane: planePort,
      openhands: openhandsPort,
      langfuse: langfusePort,
    }),
  );
})();

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
  echo "cutover_rehearsal=failed" >&2
  echo "error=mock_services_not_ready" >&2
  exit 1
fi

PLANE_PORT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).plane))' "$PORTS_FILE")"
OPENHANDS_PORT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).openhands))' "$PORTS_FILE")"
LANGFUSE_PORT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).langfuse))' "$PORTS_FILE")"

echo "cutover_rehearsal=running"
echo "mock_plane=http://127.0.0.1:${PLANE_PORT}"
echo "mock_openhands=http://127.0.0.1:${OPENHANDS_PORT}"
echo "mock_langfuse=http://127.0.0.1:${LANGFUSE_PORT}"

CUTOVER_DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
REHEARSAL_RUN_DB_SMOKE="${ACP_CUTOVER_REHEARSAL_RUN_DB_SMOKE:-true}"

if [[ "$REHEARSAL_RUN_DB_SMOKE" == "true" && "${ACP_CUTOVER_REHEARSAL_TEMP_DB:-true}" != "false" ]]; then
  TEMP_DATABASE_NAME="acp_rehearsal_$(date +%s)_$$"
  TEMP_DATABASE_URL="$(node -e 'const url = new URL(process.argv[1]); url.pathname = "/" + process.argv[2]; process.stdout.write(url.toString());' "$CUTOVER_DATABASE_URL" "$TEMP_DATABASE_NAME")"
  echo "temp_database=${TEMP_DATABASE_NAME}"
  create_temp_database "$CUTOVER_DATABASE_URL" "$TEMP_DATABASE_NAME"
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:migrate
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:seed
  CUTOVER_DATABASE_URL="$TEMP_DATABASE_URL"
fi

cat >"$SECRET_PROVIDER_FILE" <<EOF_SECRET_PROVIDER
DATABASE_URL=${CUTOVER_DATABASE_URL}
ACP_OPERATOR_API_TOKEN=rehearsal-operator-token-000000000000000000000000
ACP_OPERATOR_LOGIN_PASSWORD=rehearsal-login-password-000000000000000000000
ACP_OPERATOR_SESSION_SECRET=rehearsal-session-secret-000000000000000000000
PLANE_WEBHOOK_SECRET=rehearsal-plane-webhook-secret-000000000000000
PLANE_WRITEBACK_ENABLED=true
PLANE_BASE_URL=http://127.0.0.1:${PLANE_PORT}
PLANE_WORKSPACE_SLUG=workspace
PLANE_PROJECT_ID=project
PLANE_API_KEY=rehearsal-plane-api-key-000000000000000000000
ACP_COMPLETION_EXECUTION_PROFILE=legacy-openhands
WORKER_EXECUTION_ADAPTER=openhands-cloud
OPENHANDS_BASE_URL=http://127.0.0.1:${OPENHANDS_PORT}
OPENHANDS_API_KEY=rehearsal-openhands-api-key-0000000000000000
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=http://127.0.0.1:${LANGFUSE_PORT}
LANGFUSE_PROJECT_ID=rehearsal-project
LANGFUSE_PUBLIC_KEY=pk-rehearsal-000000000000000000000000
LANGFUSE_SECRET_KEY=sk-rehearsal-000000000000000000000000
EOF_SECRET_PROVIDER
chmod 600 "$SECRET_PROVIDER_FILE"

if [[ -z "$REPORT_FILE" ]]; then
  REPORT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-rehearsal-report.XXXXXX")"
  rm -f "$REPORT_FILE"
  REPORT_FILE_IS_TEMP="true"
fi

PLANE_BASE_URL="http://127.0.0.1:${PLANE_PORT}" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="rehearsal-plane-key" \
PLANE_WRITEBACK_SMOKE_APPLY="false" \
PLANE_WRITEBACK_SMOKE_VERIFY_COMMENTS="true" \
PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
PLANE_WRITEBACK_SMOKE_NEXT_STATE="Development" \
bash scripts/smoke-plane-writeback.sh >/dev/null

DATABASE_URL="$CUTOVER_DATABASE_URL" \
PLANE_BASE_URL="http://127.0.0.1:${PLANE_PORT}" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="rehearsal-plane-key" \
PLANE_WEBHOOK_SECRET="rehearsal-webhook-secret" \
PLANE_WRITEBACK_ENABLED="true" \
PLANE_WRITEBACK_SMOKE_APPLY="true" \
PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
PLANE_WRITEBACK_SMOKE_NEXT_STATE="Development" \
PLANE_WRITEBACK_SMOKE_STATUS="Rehearsal" \
PLANE_WRITEBACK_SMOKE_SUMMARY="Agent Control Plane cutover rehearsal writeback." \
OPENHANDS_BASE_URL="http://127.0.0.1:${OPENHANDS_PORT}" \
OPENHANDS_API_KEY="rehearsal-openhands-key" \
OPENHANDS_SMOKE_CREATE_CONVERSATION="true" \
OPENHANDS_SMOKE_WAIT_READY="true" \
OPENHANDS_SMOKE_POLL_INTERVAL_SECONDS="0" \
OPENHANDS_SMOKE_PAYLOAD_FILE="$OPENHANDS_PAYLOAD_FILE" \
OPENHANDS_ADAPTER_SMOKE_START_POLL_INTERVAL_MS="1" \
OPENHANDS_ADAPTER_SMOKE_EXECUTION_POLL_INTERVAL_MS="1" \
OPENHANDS_SELECTED_REPOSITORY="michaelx1993/aiworkspace" \
LANGFUSE_ENABLED="true" \
LANGFUSE_BASE_URL="http://127.0.0.1:${LANGFUSE_PORT}" \
LANGFUSE_PROJECT_ID="rehearsal-project" \
LANGFUSE_PUBLIC_KEY="pk-rehearsal" \
LANGFUSE_SECRET_KEY="sk-rehearsal-secret" \
LANGFUSE_SMOKE_DRY_RUN="false" \
ACP_OPERATOR_API_TOKEN="rehearsal-operator-token" \
ACP_COMPLETION_EXECUTION_PROFILE="legacy-openhands" \
ACP_CUTOVER_ALLOW_LOOPBACK_URLS="true" \
ACP_SMOKE_EXTERNAL="true" \
ACP_CUTOVER_SKIP_SECRET_VALIDATE="true" \
ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="cutover-rehearsal mock: legacy Linear/Symphony poller disabled" \
ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="cutover-rehearsal mock: Linear archive-only confirmed" \
ACP_CUTOVER_MANUAL_EVIDENCE_SUMMARY="cutover-rehearsal mock evidence" \
ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true" \
ACP_CUTOVER_RUN_OPENHANDS_SMOKE="true" \
ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="true" \
ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="$REHEARSAL_RUN_DB_SMOKE" \
ACP_CUTOVER_RUN_LANGFUSE_SMOKE="true" \
ACP_CUTOVER_TASK_SOURCE_SMOKE_PASSED="true" \
ACP_CUTOVER_TASK_SOURCE_EVIDENCE="cutover-rehearsal mock: task source audit passed" \
ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true" \
ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true" \
ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true" \
ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true" \
ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true" \
ACP_CUTOVER_REPORT_FILE="$REPORT_FILE" \
ACP_SECRET_COMMAND="cat '$SECRET_PROVIDER_FILE'" \
SECRET_PROVIDER_AUDIT_FILE="$AUDIT_FILE" \
WORKER_EXECUTION_ADAPTER="openhands-cloud" \
pnpm --silent cutover:check >"$CUTOVER_OUTPUT_FILE"

if [[ "$REPORT_FILE_IS_TEMP" == "true" ]]; then
  grep -v '^cutover_report_file=' "$CUTOVER_OUTPUT_FILE" || true
else
  cat "$CUTOVER_OUTPUT_FILE"
fi

node - "$REPORT_FILE" "$REHEARSAL_RUN_DB_SMOKE" <<'NODE'
const fs = require("node:fs");

const [reportFile, dbSmokeExpected] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(report.readiness === "passed", "cutover report readiness must be passed");
assert(report.smoke.planeWriteback === true, "plane writeback smoke must be recorded");
assert(report.smoke.openhandsConversation === true, "OpenHands conversation smoke must be recorded");
assert(report.smoke.openhandsAdapter === true, "OpenHands adapter smoke must be recorded");
assert(report.smoke.langfuseTrace === true, "Langfuse trace smoke must be recorded");
assert(report.smoke.taskSource === false, "task source smoke should use mock manual evidence in rehearsal");
assert(report.smoke.workerCrashRecovery === true, "worker crash recovery smoke must be recorded");
assert(report.smoke.workerBudget === true, "worker budget smoke must be recorded");
assert(report.smoke.workerWorkflow === true, "worker workflow smoke must be recorded");
assert(report.smoke.secretProvider === true, "secret provider smoke must be recorded");
assert(report.smoke.secretProviderAudit === true, "secret provider audit smoke must be recorded");
assert(report.smoke.externalPreflight === false, "external preflight should not run in rehearsal");
assert(
  report.smoke.openhandsDbRun === (dbSmokeExpected === "true"),
  "OpenHands DB smoke report flag does not match rehearsal setting",
);
assert(
  typeof report.evidence.openhandsConversation === "string" &&
    report.evidence.openhandsConversation.includes("/conversations/") &&
    report.evidence.openhandsConversation.includes("payload_file="),
  "OpenHands conversation payload evidence missing from report",
);
assert(
  typeof report.evidence.langfuseTrace === "string" &&
    report.evidence.langfuseTrace.includes("/traces/"),
  "Langfuse trace evidence missing from report",
);
assert(
  report.evidence.taskSource === "cutover-rehearsal mock: task source audit passed",
  "task source evidence missing from report",
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

if [[ ! -s "$OPENHANDS_PAYLOAD_FILE" ]]; then
  echo "cutover_rehearsal=failed" >&2
  echo "error=openhands_payload_file_not_written" >&2
  exit 1
fi

OPENHANDS_PAYLOAD_CONTRACT_FILE="$OPENHANDS_PAYLOAD_FILE" pnpm --silent openhands:payload-contract >/dev/null
echo "openhands_payload_capture=passed"

COMPLETION_AUDIT_OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-cutover-rehearsal-completion-audit.XXXXXX")"
set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$REPORT_FILE" \
  node scripts/completion-audit.mjs >"$COMPLETION_AUDIT_OUTPUT_FILE" 2>&1
COMPLETION_AUDIT_STATUS=$?
set -e

if [[ "$COMPLETION_AUDIT_STATUS" -eq 0 ]]; then
  echo "cutover_rehearsal=failed" >&2
  echo "error=completion_audit_unexpectedly_accepted_rehearsal_report" >&2
  cat "$COMPLETION_AUDIT_OUTPUT_FILE" >&2
  rm -f "$COMPLETION_AUDIT_OUTPUT_FILE"
  exit 1
fi

if ! grep -q "completion_audit_status=incomplete" "$COMPLETION_AUDIT_OUTPUT_FILE"; then
  echo "cutover_rehearsal=failed" >&2
  echo "error=completion_audit_did_not_report_incomplete_rehearsal" >&2
  cat "$COMPLETION_AUDIT_OUTPUT_FILE" >&2
  rm -f "$COMPLETION_AUDIT_OUTPUT_FILE"
  exit 1
fi
rm -f "$COMPLETION_AUDIT_OUTPUT_FILE"

echo "completion_audit_rejects_rehearsal=true"

if [[ "$REPORT_FILE_IS_TEMP" != "true" ]]; then
  echo "cutover_rehearsal_report_file=${REPORT_FILE}"
fi

echo "cutover_rehearsal=passed"
