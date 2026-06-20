#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

TEMP_DATABASE_NAME=""
TEMP_DATABASE_URL=""

cleanup() {
  if [[ -n "$TEMP_DATABASE_NAME" && -n "$TEMP_DATABASE_URL" ]]; then
    drop_temp_database "$TEMP_DATABASE_URL" "$TEMP_DATABASE_NAME" >/dev/null 2>&1 || true
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

load_secret_env_file
load_secret_command

if [[ "${WORKER_CODEX_PLANE_SMOKE_APPLY:-false}" != "true" ]]; then
  skip "WORKER_CODEX_PLANE_SMOKE_APPLY_not_true"
fi

require_env_or_skip "PLANE_BASE_URL"
require_env_or_skip "PLANE_WORKSPACE_SLUG"
require_env_or_skip "PLANE_PROJECT_ID"
require_env_or_skip "PLANE_API_KEY"

if [[ "${WORKER_EXECUTION_ADAPTER:-codex-cli}" == "codex-app-server" ]]; then
  CODEX_COMMAND="${WORKER_CODEX_APP_SERVER_COMMAND:-${WORKER_CODEX_COMMAND:-codex}}"
else
  CODEX_COMMAND="${WORKER_CODEX_COMMAND:-codex}"
fi
if ! command -v "$CODEX_COMMAND" >/dev/null 2>&1; then
  skip "codex_command_not_found:${CODEX_COMMAND}"
fi

SMOKE_DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
if [[ "${WORKER_CODEX_PLANE_SMOKE_TEMP_DB:-true}" != "false" ]]; then
  TEMP_DATABASE_NAME="acp_codex_plane_smoke_$(date +%s)_$$"
  TEMP_DATABASE_URL="$(node -e 'const url = new URL(process.argv[1]); url.pathname = "/" + process.argv[2]; process.stdout.write(url.toString());' "$SMOKE_DATABASE_URL" "$TEMP_DATABASE_NAME")"
  echo "temp_database=${TEMP_DATABASE_NAME}"
  create_temp_database "$SMOKE_DATABASE_URL" "$TEMP_DATABASE_NAME"
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:migrate
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:seed
  SMOKE_DATABASE_URL="$TEMP_DATABASE_URL"
fi

DATABASE_URL="$SMOKE_DATABASE_URL" pnpm --silent --filter @agent-control-plane/worker worker:codex-plane-smoke
