#!/usr/bin/env bash
set -euo pipefail

TEMP_DATABASE_NAME=""
TEMP_DATABASE_URL=""

cleanup() {
  if [[ -n "$TEMP_DATABASE_NAME" && -n "$TEMP_DATABASE_URL" ]]; then
    drop_temp_database "$TEMP_DATABASE_URL" "$TEMP_DATABASE_NAME" >/dev/null 2>&1 || true
  fi
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

SMOKE_DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
if [[ "${WORKER_WORKFLOW_SMOKE_TEMP_DB:-true}" != "false" ]]; then
  TEMP_DATABASE_NAME="acp_workflow_smoke_$(date +%s)_$$"
  TEMP_DATABASE_URL="$(node -e 'const url = new URL(process.argv[1]); url.pathname = "/" + process.argv[2]; process.stdout.write(url.toString());' "$SMOKE_DATABASE_URL" "$TEMP_DATABASE_NAME")"
  echo "temp_database=${TEMP_DATABASE_NAME}"
  create_temp_database "$SMOKE_DATABASE_URL" "$TEMP_DATABASE_NAME"
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:migrate
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:seed
  SMOKE_DATABASE_URL="$TEMP_DATABASE_URL"
fi

DATABASE_URL="$SMOKE_DATABASE_URL" pnpm --silent --filter @agent-control-plane/worker worker:workflow-smoke
