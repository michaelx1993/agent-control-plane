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

seed_task_source_sample() {
  pnpm --filter @agent-control-plane/db exec node <<'NODE'
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const taskId = "00000000-0000-4000-8000-000000009101";
  const runId = "00000000-0000-4000-8000-000000009201";
  const projectId = "00000000-0000-4000-8000-000000000101";
  const repositoryId = "00000000-0000-4000-8000-000000000201";
  const roleId = "00000000-0000-4000-8000-000000000302";
  const agentDefinitionId = "00000000-0000-4000-8000-000000000403";

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
        id,
        project_id,
        repository_id,
        external_task_id,
        identifier,
        title,
        state,
        priority,
        labels,
        url,
        last_synced_at,
        sync_cursor,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        'plane-task-source-smoke',
        'TOK-SOURCE-1',
        'Task source smoke Plane-routed sample',
        'Development',
        2,
        '["repo:crs-src","smoke"]'::jsonb,
        'https://plane.local/workspace/acme/projects/token/issues/plane-task-source-smoke',
        now(),
        '2026-06-19T12:00:00.000Z',
        now(),
        now()
      )
      on conflict (project_id, external_task_id) do update set
        repository_id = excluded.repository_id,
        state = excluded.state,
        labels = excluded.labels,
        url = excluded.url,
        updated_at = now()
    `,
    [taskId, projectId, repositoryId],
  );

  await client.query(
    `
      insert into runs (
        id,
        task_id,
        repository_id,
        role_id,
        agent_definition_id,
        status,
        attempt,
        started_at,
        finished_at,
        result_summary,
        next_state,
        token_input,
        token_output,
        token_total,
        cost_usd,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        'succeeded',
        1,
        now() - interval '2 minutes',
        now() - interval '1 minute',
        'Task source smoke run evidence.',
        'Code Review',
        100,
        40,
        140,
        0.010000,
        now() - interval '2 minutes',
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
      insert into run_events (
        id,
        run_id,
        event_type,
        message,
        payload,
        created_at
      )
      values (
        '00000000-0000-4000-8000-000000009302',
        $1,
        'codex.agent_message',
        'Codex CLI emitted task-source smoke run evidence.',
        '{"source":"task-source-local-smoke"}'::jsonb,
        now()
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
      insert into feedback_items (
        id,
        task_id,
        run_id,
        source,
        severity,
        body,
        created_at
      )
      values (
        '00000000-0000-4000-8000-000000009303',
        $1,
        $2,
        'agent_progress',
        'info',
        'Task source smoke progress/workpad evidence.',
        now()
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

  await client.query(
    `
      insert into conversation_refs (
        id,
        run_id,
        provider,
        conversation_id,
        event_log_uri,
        event_cursor,
        ui_url,
        created_at,
        updated_at
      )
      values (
        '00000000-0000-4000-8000-000000009301',
        $1,
        'openhands',
        'task-source-smoke-conversation',
        'https://openhands.local/conversations/task-source-smoke/events',
        'finished',
        'https://openhands.local/conversations/task-source-smoke',
        now(),
        now()
      )
      on conflict (run_id) do update set
        conversation_id = excluded.conversation_id,
        event_log_uri = excluded.event_log_uri,
        event_cursor = excluded.event_cursor,
        ui_url = excluded.ui_url,
        updated_at = now()
    `,
    [runId],
  );

  await client.query(
    `
      insert into trace_refs (
        id,
        run_id,
        provider,
        trace_id,
        generation_id,
        model,
        input_tokens,
        output_tokens,
        cost_usd,
        latency_ms,
        ui_url,
        created_at
      )
      values (
        '00000000-0000-4000-8000-000000009401',
        $1,
        'langfuse',
        'task-source-smoke-trace',
        'task-source-smoke-generation',
        'gpt-5.5',
        100,
        40,
        0.010000,
        1200,
        'https://langfuse.local/project/token/traces/task-source-smoke-trace',
        now()
      )
    `,
    [runId],
  );
} finally {
  await client.end();
}
NODE
}

seed_task_source_missing_evidence_sample() {
  pnpm --filter @agent-control-plane/db exec node <<'NODE'
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const taskId = "00000000-0000-4000-8000-000000009501";
  const runId = "00000000-0000-4000-8000-000000009601";
  const projectId = "00000000-0000-4000-8000-000000000101";
  const repositoryId = "00000000-0000-4000-8000-000000000201";
  const roleId = "00000000-0000-4000-8000-000000000302";
  const agentDefinitionId = "00000000-0000-4000-8000-000000000403";

  await client.query(
    `
      insert into tasks (
        id,
        project_id,
        repository_id,
        external_task_id,
        identifier,
        title,
        state,
        priority,
        labels,
        url,
        last_synced_at,
        sync_cursor,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        'plane-task-source-missing-evidence-smoke',
        'TOK-SOURCE-MISSING',
        'Task source smoke missing run event and progress evidence sample',
        'Development',
        3,
        '["repo:crs-src","smoke"]'::jsonb,
        'https://plane.local/workspace/acme/projects/token/issues/plane-task-source-missing-evidence-smoke',
        now(),
        '2026-06-19T12:00:00.000Z',
        now(),
        now()
      )
      on conflict (project_id, external_task_id) do update set
        repository_id = excluded.repository_id,
        state = excluded.state,
        labels = excluded.labels,
        url = excluded.url,
        updated_at = now()
    `,
    [taskId, projectId, repositoryId],
  );

  await client.query(
    `
      insert into runs (
        id,
        task_id,
        repository_id,
        role_id,
        agent_definition_id,
        status,
        attempt,
        started_at,
        finished_at,
        result_summary,
        next_state,
        token_input,
        token_output,
        token_total,
        cost_usd,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        'succeeded',
        1,
        now() - interval '2 minutes',
        now() - interval '1 minute',
        'Task source smoke run without event/progress evidence.',
        'Code Review',
        100,
        40,
        140,
        0.010000,
        now() - interval '2 minutes',
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
} finally {
  await client.end();
}
NODE
}

disable_missing_evidence_sample() {
  pnpm --filter @agent-control-plane/db exec node <<'NODE'
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    `
      update tasks
      set state = 'Backlog', updated_at = now()
      where identifier = 'TOK-SOURCE-MISSING'
    `,
  );
} finally {
  await client.end();
}
NODE
}

SMOKE_DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
if [[ "${TASK_SOURCE_LOCAL_SMOKE_TEMP_DB:-true}" != "false" ]]; then
  TEMP_DATABASE_NAME="acp_task_source_smoke_$(date +%s)_$$"
  TEMP_DATABASE_URL="$(node -e 'const url = new URL(process.argv[1]); url.pathname = "/" + process.argv[2]; process.stdout.write(url.toString());' "$SMOKE_DATABASE_URL" "$TEMP_DATABASE_NAME")"
  echo "temp_database=${TEMP_DATABASE_NAME}"
  create_temp_database "$SMOKE_DATABASE_URL" "$TEMP_DATABASE_NAME"
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:migrate
  DATABASE_URL="$TEMP_DATABASE_URL" pnpm --silent db:seed
  SMOKE_DATABASE_URL="$TEMP_DATABASE_URL"
fi

DATABASE_URL="$SMOKE_DATABASE_URL" seed_task_source_sample
DATABASE_URL="$SMOKE_DATABASE_URL" seed_task_source_missing_evidence_sample

FAIL_OUTPUT="$(mktemp)"
set +e
DATABASE_URL="$SMOKE_DATABASE_URL" \
ACP_COMPLETION_EXECUTION_PROFILE="codex-cli" \
TASK_SOURCE_SMOKE_PLANE_BASE_URL="https://plane.local" \
TASK_SOURCE_SMOKE_PROJECT_SLUG="token" \
pnpm --silent task-source:smoke >"$FAIL_OUTPUT" 2>&1
FAIL_STATUS=$?
set -e

if [[ "$FAIL_STATUS" -eq 0 ]]; then
  echo "task_source_local_smoke=failed" >&2
  echo "error=task-source smoke codex evidence requirements unexpectedly passed" >&2
  cat "$FAIL_OUTPUT" >&2
  rm -f "$FAIL_OUTPUT"
  exit 1
fi

if ! grep -q "missing_run_event_evidence" "$FAIL_OUTPUT"; then
  echo "task_source_local_smoke=failed" >&2
  echo "error=task-source smoke did not fail on missing run event evidence" >&2
  cat "$FAIL_OUTPUT" >&2
  rm -f "$FAIL_OUTPUT"
  exit 1
fi

if ! grep -q "missing_progress_evidence" "$FAIL_OUTPUT"; then
  echo "task_source_local_smoke=failed" >&2
  echo "error=task-source smoke did not fail on missing progress evidence" >&2
  cat "$FAIL_OUTPUT" >&2
  rm -f "$FAIL_OUTPUT"
  exit 1
fi

if grep -q "missing_conversation_evidence\\|missing_trace_evidence" "$FAIL_OUTPUT"; then
  echo "task_source_local_smoke=failed" >&2
  echo "error=task-source smoke codex profile unexpectedly required legacy evidence" >&2
  cat "$FAIL_OUTPUT" >&2
  rm -f "$FAIL_OUTPUT"
  exit 1
fi
rm -f "$FAIL_OUTPUT"

DATABASE_URL="$SMOKE_DATABASE_URL" disable_missing_evidence_sample

DATABASE_URL="$SMOKE_DATABASE_URL" \
ACP_COMPLETION_EXECUTION_PROFILE="codex-cli" \
TASK_SOURCE_SMOKE_PLANE_BASE_URL="https://plane.local" \
TASK_SOURCE_SMOKE_PROJECT_SLUG="token" \
pnpm --silent task-source:smoke

DATABASE_URL="$SMOKE_DATABASE_URL" seed_task_source_missing_evidence_sample

FAIL_OUTPUT="$(mktemp)"
set +e
DATABASE_URL="$SMOKE_DATABASE_URL" \
ACP_COMPLETION_EXECUTION_PROFILE="legacy-openhands" \
TASK_SOURCE_SMOKE_PLANE_BASE_URL="https://plane.local" \
TASK_SOURCE_SMOKE_PROJECT_SLUG="token" \
pnpm --silent task-source:smoke >"$FAIL_OUTPUT" 2>&1
FAIL_STATUS=$?
set -e

if [[ "$FAIL_STATUS" -eq 0 ]]; then
  echo "task_source_local_smoke=failed" >&2
  echo "error=task-source smoke legacy evidence requirements unexpectedly passed" >&2
  cat "$FAIL_OUTPUT" >&2
  rm -f "$FAIL_OUTPUT"
  exit 1
fi

if ! grep -q "missing_conversation_evidence" "$FAIL_OUTPUT"; then
  echo "task_source_local_smoke=failed" >&2
  echo "error=task-source smoke legacy profile did not require conversation evidence" >&2
  cat "$FAIL_OUTPUT" >&2
  rm -f "$FAIL_OUTPUT"
  exit 1
fi

if ! grep -q "missing_trace_evidence" "$FAIL_OUTPUT"; then
  echo "task_source_local_smoke=failed" >&2
  echo "error=task-source smoke legacy profile did not require trace evidence" >&2
  cat "$FAIL_OUTPUT" >&2
  rm -f "$FAIL_OUTPUT"
  exit 1
fi
rm -f "$FAIL_OUTPUT"

DATABASE_URL="$SMOKE_DATABASE_URL" disable_missing_evidence_sample

DATABASE_URL="$SMOKE_DATABASE_URL" \
ACP_COMPLETION_EXECUTION_PROFILE="legacy-openhands" \
TASK_SOURCE_SMOKE_PLANE_BASE_URL="https://plane.local" \
TASK_SOURCE_SMOKE_PROJECT_SLUG="token" \
pnpm --silent task-source:smoke
