#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if [[ ! -f "$file" ]]; then
    echo "task_source_smoke=failed" >&2
    echo "error=ACP_SECRET_ENV_FILE not found: ${file}" >&2
    exit 1
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    echo "task_source_smoke=failed" >&2
    echo "error=ACP_SECRET_ENV_FILE permissions must be 600 or 400: ${file}" >&2
    exit 1
  fi

  if ! load_dotenv_file_safe "$file"; then
    echo "task_source_smoke=failed" >&2
    echo "error=ACP_SECRET_ENV_FILE invalid dotenv" >&2
    exit 1
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
    echo "task_source_smoke=failed" >&2
    echo "error=ACP_SECRET_COMMAND failed" >&2
    exit 1
  fi

  chmod 600 "$tmp_file"
  if ! load_dotenv_file_safe "$tmp_file"; then
    echo "task_source_smoke=failed" >&2
    echo "error=ACP_SECRET_COMMAND invalid dotenv" >&2
    exit 1
  fi
  rm -f "$tmp_file"
}

load_secret_env_file
load_secret_command

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "task_source_smoke=failed" >&2
  echo "error=DATABASE_URL is required" >&2
  exit 1
fi

if [[ -z "${TASK_SOURCE_SMOKE_PLANE_BASE_URL:-${PLANE_BASE_URL:-}}" ]]; then
  echo "task_source_smoke=failed" >&2
  echo "error=PLANE_BASE_URL or TASK_SOURCE_SMOKE_PLANE_BASE_URL is required" >&2
  exit 1
fi

export ACP_COMPLETION_EXECUTION_PROFILE="${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}"
export TASK_SOURCE_SMOKE_EXECUTION_PROFILE="${TASK_SOURCE_SMOKE_EXECUTION_PROFILE:-$ACP_COMPLETION_EXECUTION_PROFILE}"
export TASK_SOURCE_SMOKE_REQUIRE_SAMPLE="${TASK_SOURCE_SMOKE_REQUIRE_SAMPLE:-true}"

case "$TASK_SOURCE_SMOKE_EXECUTION_PROFILE" in
  legacy-openhands | openhands | openhands-cloud | openhands-langfuse)
    export TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE:-true}"
    export TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE:-false}"
    export TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_EVIDENCE:-false}"
    export TASK_SOURCE_SMOKE_REQUIRE_PROMPT_RELEASE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_PROMPT_RELEASE_EVIDENCE:-false}"
    export TASK_SOURCE_SMOKE_REQUIRE_WORKSPACE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_WORKSPACE_EVIDENCE:-false}"
    export TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE:-true}"
    export TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE:-true}"
    ;;
  *)
    export TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE:-true}"
    export TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE:-true}"
    export TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_EVIDENCE:-true}"
    export TASK_SOURCE_SMOKE_REQUIRE_PROMPT_RELEASE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_PROMPT_RELEASE_EVIDENCE:-true}"
    export TASK_SOURCE_SMOKE_REQUIRE_WORKSPACE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_WORKSPACE_EVIDENCE:-true}"
    export TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE:-false}"
    export TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE:-false}"
    ;;
esac

pnpm --filter @agent-control-plane/db build >/dev/null
node scripts/task-source-smoke.mjs
