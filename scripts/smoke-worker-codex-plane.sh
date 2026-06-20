#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

TEMP_DATABASE_NAME=""
TEMP_DATABASE_URL=""
WORKER_OUTPUT_FILE=""

cleanup() {
  if [[ -n "$TEMP_DATABASE_NAME" && -n "$TEMP_DATABASE_URL" ]]; then
    drop_temp_database "$TEMP_DATABASE_URL" "$TEMP_DATABASE_NAME" >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORKER_OUTPUT_FILE" ]]; then
    rm -f "$WORKER_OUTPUT_FILE"
  fi
}
trap cleanup EXIT

skip() {
  printf 'worker_codex_plane_smoke=skipped\n'
  printf 'reason=%s\n' "$1"
  exit 0
}

fail() {
  printf 'worker_codex_plane_smoke=failed\n' >&2
  printf 'error=%s\n' "$1" >&2
  exit 1
}

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if [[ ! -f "$file" ]]; then
    fail "secret_env_file_not_found"
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    fail "secret_env_file_permissions"
  fi

  if ! load_dotenv_file_safe "$file"; then
    fail "secret_env_file_invalid"
  fi
}

load_secret_command() {
  local command="${ACP_SECRET_COMMAND:-}"
  if [[ -z "$command" ]]; then
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! bash -c "$command" >"$tmp_file"; then
    rm -f "$tmp_file"
    fail "secret_command_failed"
  fi

  chmod 600 "$tmp_file"
  if ! load_dotenv_file_safe "$tmp_file"; then
    fail "secret_command_invalid_dotenv"
  fi
  rm -f "$tmp_file"
}

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

require_env_or_skip() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    skip "${name}_missing"
  fi
}

default_agent_worker_repo_path() {
  cd "$SCRIPT_DIR/../.." >/dev/null
  pwd
}

verify_database_evidence() {
  local database_url="$1"
  local run_id="$2"

  pnpm --filter @agent-control-plane/db exec node - "$database_url" "$run_id" <<'NODE'
import { Client } from "pg";

const [databaseUrl, runId] = process.argv.slice(2);
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(
    `
      select
        tasks.identifier,
        tasks.url,
        tasks.state,
        runs.status,
        runs.next_state,
        roles.key as role,
        repositories.slug as repository_slug,
        (
          select count(*)::integer
          from run_events
          where run_events.run_id = runs.id
            and run_events.event_type like 'codex.%'
        ) as codex_events,
        (
          select count(*)::integer
          from feedback_items
          where feedback_items.task_id = tasks.id
            and feedback_items.source = 'agent_progress'
            and feedback_items.body like 'Agent Status: Running.%'
        ) as running_progress,
        (
          select count(*)::integer
          from feedback_items
          where feedback_items.task_id = tasks.id
            and feedback_items.source = 'agent_progress'
            and feedback_items.body like 'Agent Events:%'
        ) as event_progress,
        (
          select count(*)::integer
          from feedback_items
          where feedback_items.task_id = tasks.id
            and feedback_items.source = 'agent_progress'
            and feedback_items.body like 'Agent Status: Completed.%'
        ) as completed_progress
        ,
        (
          select count(*)::integer
          from run_events
          where run_events.run_id = runs.id
            and run_events.event_type = 'codex.thread_reused'
        ) as thread_reuse_events,
        (
          select count(*)::integer
          from conversation_refs
          where conversation_refs.run_id = runs.id
            and conversation_refs.provider = 'codex-app-server'
        ) as app_server_conversations
      from runs
      join tasks on tasks.id = runs.task_id
      join roles on roles.id = runs.role_id
      join repositories on repositories.id = runs.repository_id
      where runs.id = $1
      limit 1
    `,
    [runId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`run_not_found:${runId}`);
  }
  if (row.status !== "succeeded") {
    throw new Error(`run_not_succeeded:${row.status}`);
  }
  if (!row.url || !String(row.url).includes("/workspace/")) {
    throw new Error("task_url_is_not_plane_work_item");
  }
  if (Number(row.codex_events) <= 0) {
    throw new Error("missing_codex_run_events");
  }
  if (Number(row.running_progress) <= 0) {
    throw new Error("missing_running_progress");
  }
  if (Number(row.event_progress) <= 0) {
    throw new Error("missing_event_progress");
  }
  if (Number(row.completed_progress) <= 0) {
    throw new Error("missing_completed_progress");
  }
  if (process.env.WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP === "true") {
    if (Number(row.thread_reuse_events) <= 0) {
      throw new Error("missing_codex_app_server_thread_reuse_event");
    }
    if (Number(row.app_server_conversations) <= 0) {
      throw new Error("missing_codex_app_server_conversation_ref");
    }
  }

  console.log(`task_identifier=${row.identifier}`);
  console.log(`task_state=${row.state}`);
  console.log(`task_url=${row.url}`);
  console.log(`repository_slug=${row.repository_slug}`);
  console.log(`role=${row.role}`);
  console.log(`run_status=${row.status}`);
  console.log(`run_next_state=${row.next_state ?? ""}`);
  console.log(`codex_events=${row.codex_events}`);
  console.log(`running_progress=${row.running_progress}`);
  console.log(`event_progress=${row.event_progress}`);
  console.log(`completed_progress=${row.completed_progress}`);
  console.log(`thread_reuse_events=${row.thread_reuse_events}`);
  console.log(`app_server_conversations=${row.app_server_conversations}`);
} finally {
  await client.end();
}
NODE
}

extract_worker_result_json() {
  node - "$1" <<'NODE'
import { readFileSync } from "node:fs";

const file = process.argv[2];
const raw = readFileSync(file, "utf8");
const candidates = [
  raw.trim(),
  ...raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}")),
];

for (const candidate of candidates) {
  if (!candidate) continue;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.claimed)) {
      process.stdout.write(JSON.stringify(parsed));
      process.exit(0);
    }
  } catch {
    // Try the next candidate.
  }
}

const firstBrace = raw.indexOf("{");
if (firstBrace >= 0) {
  try {
    const parsed = JSON.parse(raw.slice(firstBrace));
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.claimed)) {
      process.stdout.write(JSON.stringify(parsed));
      process.exit(0);
    }
  } catch {
    // Fall through to the explicit error below.
  }
}

throw new Error("worker_output_missing_result_json");
NODE
}

write_success_report() {
  local report_file="$1"
  local worker_json="$2"
  local database_evidence="$3"
  local execution_adapter="$4"
  local control_plane_base_url="$5"
  local agent_worker_repo_path="$6"
  local workspace_strategy="$7"
  local workspace_root="$8"
  local codex_model="$9"
  local codex_reasoning_effort="${10}"
  local follow_up_required="${11}"

  if [[ -z "$report_file" ]]; then
    return
  fi
  if ! node "$SCRIPT_DIR/write-worker-codex-plane-smoke-report.mjs" \
    "$report_file" \
    "$worker_json" \
    "$database_evidence" \
    "$execution_adapter" \
    "$control_plane_base_url" \
    "$agent_worker_repo_path" \
    "$workspace_strategy" \
    "$workspace_root" \
    "$codex_model" \
    "$codex_reasoning_effort" \
    "$follow_up_required" \
    "${WORKER_CODEX_PLANE_SMOKE_REPORT_OVERWRITE:-false}"; then
    fail "report_write_failed"
  fi
  printf 'worker_codex_plane_smoke_report_file=%s\n' "$report_file"
}

load_secret_env_file
load_secret_command

if [[ "${WORKER_CODEX_PLANE_SMOKE_APPLY:-false}" != "true" ]]; then
  skip "WORKER_CODEX_PLANE_SMOKE_APPLY_not_true"
fi

if [[ "${WORKER_CODEX_PLANE_SMOKE_REQUIRE_PLANE_ENV:-false}" == "true" ]]; then
  require_env_or_skip "PLANE_BASE_URL"
  require_env_or_skip "PLANE_WORKSPACE_SLUG"
  require_env_or_skip "PLANE_PROJECT_ID"
  require_env_or_skip "PLANE_API_KEY"
fi

if [[ "${WORKER_EXECUTION_ADAPTER:-codex-cli}" == "codex-app-server" ]]; then
  CODEX_COMMAND="${WORKER_CODEX_APP_SERVER_COMMAND:-${WORKER_CODEX_COMMAND:-codex}}"
else
  CODEX_COMMAND="${WORKER_CODEX_COMMAND:-codex}"
fi
if ! command -v "$CODEX_COMMAND" >/dev/null 2>&1; then
  skip "codex_command_not_found:${CODEX_COMMAND}"
fi

AGENT_WORKER_REPO_PATH="${AGENT_WORKER_REPO_PATH:-$(default_agent_worker_repo_path)/agent-worker}"
if [[ ! -f "$AGENT_WORKER_REPO_PATH/package.json" ]]; then
  skip "agent_worker_repo_not_found:${AGENT_WORKER_REPO_PATH}"
fi

SMOKE_DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
if [[ "${WORKER_CODEX_PLANE_SMOKE_TEMP_DB:-true}" != "false" ]]; then
  skip "split_worker_smoke_requires_existing_control_plane"
fi

require_env_or_skip "CONTROL_PLANE_BASE_URL"
require_env_or_skip "ACP_WORKER_API_TOKEN"

WORKER_ID="${WORKER_ID:-worker-codex-plane-smoke-$$}"
WORKER_WORKSPACE_ROOT="${WORKER_WORKSPACE_ROOT:-/tmp/acp-worker-codex-plane-smoke}"
WORKER_WORKSPACE_STRATEGY="${WORKER_WORKSPACE_STRATEGY:-git-worktree}"

if [[ "${WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP:-false}" == "true" && "${WORKER_EXECUTION_ADAPTER:-codex-cli}" != "codex-app-server" ]]; then
  fail "follow_up_smoke_requires_codex_app_server"
fi

WORKER_OUTPUT_FILE="$(mktemp)"
if ! env \
  CONTROL_PLANE_BASE_URL="$CONTROL_PLANE_BASE_URL" \
  ACP_WORKER_API_TOKEN="$ACP_WORKER_API_TOKEN" \
  WORKER_ID="$WORKER_ID" \
  WORKER_RUN_LOOP=false \
  WORKER_EXECUTION_ADAPTER="${WORKER_EXECUTION_ADAPTER:-codex-cli}" \
  WORKER_WORKSPACE_ROOT="$WORKER_WORKSPACE_ROOT" \
  WORKER_WORKSPACE_STRATEGY="$WORKER_WORKSPACE_STRATEGY" \
  WORKER_CODEX_COMMAND="${WORKER_CODEX_COMMAND:-codex}" \
  WORKER_CODEX_ARGS_JSON="${WORKER_CODEX_ARGS_JSON:-}" \
  WORKER_CODEX_APP_SERVER_COMMAND="${WORKER_CODEX_APP_SERVER_COMMAND:-${WORKER_CODEX_COMMAND:-codex}}" \
  WORKER_CODEX_APP_SERVER_ARGS_JSON="${WORKER_CODEX_APP_SERVER_ARGS_JSON:-}" \
  WORKER_CODEX_MODEL="${WORKER_CODEX_MODEL:-gpt-5.5}" \
  WORKER_CODEX_REASONING_EFFORT="${WORKER_CODEX_REASONING_EFFORT:-medium}" \
  WORKER_CODEX_TIMEOUT_MS="${WORKER_CODEX_TIMEOUT_MS:-600000}" \
  pnpm --silent --dir "$AGENT_WORKER_REPO_PATH" --filter @agent-control-plane/worker dev \
    >"$WORKER_OUTPUT_FILE"; then
  cat "$WORKER_OUTPUT_FILE" >&2
  fail "agent_worker_run_failed"
fi

worker_result_json="$(extract_worker_result_json "$WORKER_OUTPUT_FILE")"

node - "$worker_result_json" <<'NODE'
const result = JSON.parse(process.argv[2]);
if (!Array.isArray(result.claimed) || result.claimed.length === 0) {
  throw new Error("worker_claimed_no_runs");
}
if (Array.isArray(result.failed) && result.failed.length > 0) {
  throw new Error("worker_reported_failed_runs");
}
if (!Array.isArray(result.completed) || result.completed.length === 0) {
  throw new Error("worker_completed_no_runs");
}
const claimed = result.claimed[0];
const completed = result.completed[0];
console.log("worker_codex_plane_smoke=passed");
console.log(`worker_id=${result.workerId}`);
console.log(`run_id=${completed.runId ?? claimed.runId}`);
console.log(`task_id=${completed.taskId ?? claimed.taskId}`);
console.log(`identifier=${claimed.identifier}`);
console.log(`role=${claimed.role}`);
console.log(`repository_slug=${claimed.repositorySlug}`);
NODE

run_id="$(node - "$worker_result_json" <<'NODE'
const result = JSON.parse(process.argv[2]);
process.stdout.write(result.completed?.[0]?.runId ?? result.claimed?.[0]?.runId ?? "");
NODE
)"

database_evidence_output=""
if [[ -n "${SMOKE_DATABASE_URL:-}" && -n "$run_id" ]]; then
  database_evidence_output="$(verify_database_evidence "$SMOKE_DATABASE_URL" "$run_id")"
  printf '%s\n' "$database_evidence_output"
fi

write_success_report \
  "${WORKER_CODEX_PLANE_SMOKE_REPORT_FILE:-}" \
  "$worker_result_json" \
  "$database_evidence_output" \
  "${WORKER_EXECUTION_ADAPTER:-codex-cli}" \
  "$CONTROL_PLANE_BASE_URL" \
  "$AGENT_WORKER_REPO_PATH" \
  "$WORKER_WORKSPACE_STRATEGY" \
  "$WORKER_WORKSPACE_ROOT" \
  "${WORKER_CODEX_MODEL:-gpt-5.5}" \
  "${WORKER_CODEX_REASONING_EFFORT:-medium}" \
  "${WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP:-false}"
