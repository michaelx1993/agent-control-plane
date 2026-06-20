#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

fail_final() {
  echo "completion_final=failed" >&2
  echo "error=$1" >&2
  exit 1
}

is_placeholder_value() {
  local value="$1"
  [[ "$value" == *"<"*">"* || "$value" == *"example.com"* || "$value" == *"YYYY-MM-DD"* || "$value" == "owner/repo" ]]
}

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if is_placeholder_value "$file"; then
    fail_final "ACP_SECRET_ENV_FILE still contains a template placeholder"
  fi

  if [[ ! -f "$file" ]]; then
    fail_final "ACP_SECRET_ENV_FILE not found: ${file}"
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    fail_final "ACP_SECRET_ENV_FILE permissions must be 600 or 400: ${file}"
  fi

  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    rm -f "$load_error_file"
    fail_final "ACP_SECRET_ENV_FILE invalid dotenv: ${load_error}"
  fi
  rm -f "$load_error_file"
}

load_secret_command() {
  local command="${ACP_SECRET_COMMAND:-}"
  if [[ -z "$command" ]]; then
    return
  fi

  if is_placeholder_value "$command"; then
    fail_final "ACP_SECRET_COMMAND still contains a template placeholder"
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! bash -c "$command" >"$tmp_file"; then
    rm -f "$tmp_file"
    fail_final "ACP_SECRET_COMMAND failed"
  fi

  chmod 600 "$tmp_file"
  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$tmp_file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    rm -f "$load_error_file" "$tmp_file"
    fail_final "ACP_SECRET_COMMAND invalid dotenv: ${load_error}"
  fi
  rm -f "$load_error_file" "$tmp_file"
}

load_secret_env_file
load_secret_command

FINAL_RUN_ID="${ACP_COMPLETION_FINAL_RUN_ID:-final-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
REPORT_FILE="${ACP_CUTOVER_REPORT_FILE:-reports/cutover-${FINAL_RUN_ID}.json}"
DEFAULT_FINAL_ENV_FILE=".secrets/completion-final.env"
COMPLETION_EXECUTION_PROFILE="${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}"

case "$COMPLETION_EXECUTION_PROFILE" in
  codex-cli | openhands-cloud | openhands-langfuse | external) ;;
  *)
    fail_final "ACP_COMPLETION_EXECUTION_PROFILE must be codex-cli, openhands-cloud, openhands-langfuse, or external"
    ;;
esac

default_final_env_file_exists() {
  if [[ -f "$DEFAULT_FINAL_ENV_FILE" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

default_final_env_file_hint() {
  if [[ -n "${ACP_SECRET_ENV_FILE:-}" ]]; then
    printf 'using_explicit_secret_env_file'
  elif [[ -f "$DEFAULT_FINAL_ENV_FILE" ]]; then
    printf 'use_existing_default_with_ACP_SECRET_ENV_FILE'
  else
    printf 'generate_default_final_env_file'
  fi
}

final_env_file_for_next_command() {
  if [[ -n "${ACP_SECRET_ENV_FILE:-}" ]]; then
    printf '%s' "$ACP_SECRET_ENV_FILE"
  else
    printf '%s' "$DEFAULT_FINAL_ENV_FILE"
  fi
}

final_env_template_command() {
  local final_env_file="$1"
  if [[ -f "$final_env_file" ]]; then
    printf 'ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=%s ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template' "$final_env_file"
  else
    printf 'ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=%s pnpm completion:final-env-template' "$final_env_file"
  fi
}

export ACP_CUTOVER_REPORT_FILE="$REPORT_FILE"
export ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID"
export ACP_COMPLETION_EXECUTION_PROFILE="$COMPLETION_EXECUTION_PROFILE"
export ACP_EXTERNAL_PREFLIGHT_ID="${ACP_EXTERNAL_PREFLIGHT_ID:-external-preflight-${FINAL_RUN_ID}}"
export ACP_CUTOVER_REPORT_ID="${ACP_CUTOVER_REPORT_ID:-cutover-report-${FINAL_RUN_ID}}"
if [[ -n "${ACP_COMPLETION_AUDIT_REPORT_FILE:-}" && "$ACP_COMPLETION_AUDIT_REPORT_FILE" != "$REPORT_FILE" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_COMPLETION_AUDIT_REPORT_FILE must match ACP_CUTOVER_REPORT_FILE for final completion gate" >&2
  exit 1
fi
export ACP_COMPLETION_AUDIT_REPORT_FILE="$REPORT_FILE"

export ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="${ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE:-true}"
if [[ "$COMPLETION_EXECUTION_PROFILE" == "codex-cli" ]]; then
  export ACP_CUTOVER_RUN_PRODUCTION_SMOKE="${ACP_CUTOVER_RUN_PRODUCTION_SMOKE:-true}"
  export ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="${ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE:-true}"
  export ACP_CUTOVER_RUN_OPENHANDS_SMOKE="${ACP_CUTOVER_RUN_OPENHANDS_SMOKE:-false}"
  export ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="${ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE:-false}"
  export ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="${ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE:-false}"
  export ACP_CUTOVER_RUN_LANGFUSE_SMOKE="${ACP_CUTOVER_RUN_LANGFUSE_SMOKE:-false}"
else
  export ACP_CUTOVER_RUN_PRODUCTION_SMOKE="${ACP_CUTOVER_RUN_PRODUCTION_SMOKE:-true}"
  export ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="${ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE:-false}"
  export ACP_CUTOVER_RUN_OPENHANDS_SMOKE="${ACP_CUTOVER_RUN_OPENHANDS_SMOKE:-true}"
  export ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="${ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE:-true}"
  export ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="${ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE:-true}"
  export ACP_CUTOVER_RUN_LANGFUSE_SMOKE="${ACP_CUTOVER_RUN_LANGFUSE_SMOKE:-true}"
fi
export ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="${ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE:-true}"
export ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="${ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE:-true}"
export ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="${ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE:-true}"
export ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="${ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE:-true}"
export ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="${ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE:-true}"
export ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="${ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE:-true}"
export ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="${ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT:-true}"
if [[ "$COMPLETION_EXECUTION_PROFILE" == "codex-cli" ]]; then
  export ACP_SMOKE_EXTERNAL="${ACP_SMOKE_EXTERNAL:-false}"
  export WORKER_EXECUTION_ADAPTER="${WORKER_EXECUTION_ADAPTER:-codex-cli}"
  export LANGFUSE_ENABLED="${LANGFUSE_ENABLED:-false}"
  export TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE:-false}"
else
  export ACP_SMOKE_EXTERNAL="${ACP_SMOKE_EXTERNAL:-true}"
  export WORKER_EXECUTION_ADAPTER="${WORKER_EXECUTION_ADAPTER:-openhands-cloud}"
  export LANGFUSE_ENABLED="${LANGFUSE_ENABLED:-true}"
  export TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE:-true}"
fi
export PLANE_WRITEBACK_ENABLED="${PLANE_WRITEBACK_ENABLED:-true}"
export PLANE_WRITEBACK_SMOKE_APPLY="${PLANE_WRITEBACK_SMOKE_APPLY:-true}"
export OPENHANDS_SMOKE_CREATE_CONVERSATION="${OPENHANDS_SMOKE_CREATE_CONVERSATION:-${ACP_CUTOVER_RUN_OPENHANDS_SMOKE}}"
export OPENHANDS_SMOKE_WAIT_READY="${OPENHANDS_SMOKE_WAIT_READY:-${ACP_CUTOVER_RUN_OPENHANDS_SMOKE}}"
export OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF="${OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF:-${ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE}}"
if [[ "$COMPLETION_EXECUTION_PROFILE" == "codex-cli" ]]; then
  export LANGFUSE_SMOKE_DRY_RUN="${LANGFUSE_SMOKE_DRY_RUN:-true}"
else
  export LANGFUSE_SMOKE_DRY_RUN="${LANGFUSE_SMOKE_DRY_RUN:-false}"
fi

require_true() {
  local name="$1"
  if [[ "${!name:-false}" != "true" ]]; then
    echo "completion_final=failed" >&2
    echo "error=${name} must be true for final completion gate" >&2
    exit 1
  fi
}

require_value() {
  local name="$1"
  local expected="$2"
  if [[ "${!name:-}" != "$expected" ]]; then
    echo "completion_final=failed" >&2
    echo "error=${name} must be ${expected} for final completion gate" >&2
    exit 1
  fi
}

require_value_in() {
  local name="$1"
  local expected_description="$2"
  shift 2

  local value="${!name:-}"
  for expected in "$@"; do
    if [[ "$value" == "$expected" ]]; then
      return
    fi
  done

  echo "completion_final=failed" >&2
  echo "error=${name} must be ${expected_description} for final completion gate" >&2
  exit 1
}

for flag in \
  ACP_CUTOVER_RUN_PRODUCTION_SMOKE \
  ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE \
  ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE \
  ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE \
  ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE \
  ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE \
  ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT \
  PLANE_WRITEBACK_ENABLED \
  PLANE_WRITEBACK_SMOKE_APPLY; do
  require_true "$flag"
done

if [[ "$COMPLETION_EXECUTION_PROFILE" == "codex-cli" ]]; then
  require_true "ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE"
  require_value_in "WORKER_EXECUTION_ADAPTER" "codex-cli or codex-app-server" "codex-cli" "codex-app-server"
else
  require_true "ACP_CUTOVER_RUN_PRODUCTION_SMOKE"
  require_true "ACP_SMOKE_EXTERNAL"
  for flag in \
    ACP_CUTOVER_RUN_OPENHANDS_SMOKE \
    ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE \
    ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE \
    ACP_CUTOVER_RUN_LANGFUSE_SMOKE \
    LANGFUSE_ENABLED \
    OPENHANDS_SMOKE_CREATE_CONVERSATION \
    OPENHANDS_SMOKE_WAIT_READY \
    OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF; do
    require_true "$flag"
  done
  require_value "WORKER_EXECUTION_ADAPTER" "openhands-cloud"
  require_value "LANGFUSE_SMOKE_DRY_RUN" "false"
fi

if [[ "${ACP_CUTOVER_SKIP_SECRET_VALIDATE:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_CUTOVER_SKIP_SECRET_VALIDATE must not be true for final completion gate" >&2
  exit 1
fi

if [[ "${ACP_SMOKE_SKIP_SECRET_VALIDATE:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_SMOKE_SKIP_SECRET_VALIDATE must not be true for final completion gate" >&2
  exit 1
fi

if [[ "${ACP_SMOKE_ENABLE_USER_WRITE:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_SMOKE_ENABLE_USER_WRITE must not be true for final completion gate" >&2
  exit 1
fi

if [[ "${ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING must not be true for final completion gate" >&2
  exit 1
fi

if [[ "${ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE must not be true for final completion gate" >&2
  exit 1
fi

if [[ "${ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE must not be true for final completion gate" >&2
  exit 1
fi

if [[ "${ACP_CUTOVER_ALLOW_LOOPBACK_URLS:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_CUTOVER_ALLOW_LOOPBACK_URLS must not be true for final completion gate" >&2
  exit 1
fi

if [[ "${ACP_CUTOVER_REPORT_OVERWRITE:-false}" == "true" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_CUTOVER_REPORT_OVERWRITE must not be true for final completion gate" >&2
  exit 1
fi

for flag in \
  WORKER_CRASH_SMOKE_TEMP_DB \
  WORKER_BUDGET_SMOKE_TEMP_DB \
  WORKER_WORKFLOW_SMOKE_TEMP_DB; do
  if [[ "${!flag:-true}" == "false" ]]; then
    echo "completion_final=failed" >&2
    echo "error=${flag} must not be false for final completion gate" >&2
    exit 1
  fi
done

if [[ "${ACP_COMPLETION_FINAL_DRY_RUN:-false}" == "true" ]]; then
  cat <<EOF
completion_final_dry_run=passed
completion_execution_profile=${ACP_COMPLETION_EXECUTION_PROFILE}
completion_final_run_id=${ACP_COMPLETION_FINAL_RUN_ID}
external_preflight_id=${ACP_EXTERNAL_PREFLIGHT_ID}
cutover_report_id=${ACP_CUTOVER_REPORT_ID}
cutover_report_file=${ACP_CUTOVER_REPORT_FILE}
completion_audit_report_file=${ACP_COMPLETION_AUDIT_REPORT_FILE}
secret_env_file=${ACP_SECRET_ENV_FILE:-not-set}
default_final_env_file=${DEFAULT_FINAL_ENV_FILE}
default_final_env_file_exists=$(default_final_env_file_exists)
default_final_env_file_hint=$(default_final_env_file_hint)
next_command_generate_env_template=$(final_env_template_command "$(final_env_file_for_next_command)")
next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=$(final_env_file_for_next_command) pnpm external:preflight
next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=$(final_env_file_for_next_command) pnpm completion:gap
next_command_run_final=ACP_SECRET_ENV_FILE=$(final_env_file_for_next_command) pnpm completion:final
production_smoke=${ACP_CUTOVER_RUN_PRODUCTION_SMOKE}
plane_writeback_smoke=${ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE}
codex_adapter_smoke=${ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE}
openhands_smoke=${ACP_CUTOVER_RUN_OPENHANDS_SMOKE}
openhands_adapter_smoke=${ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE}
openhands_db_smoke=${ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE}
langfuse_smoke=${ACP_CUTOVER_RUN_LANGFUSE_SMOKE}
task_source_smoke=${ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE}
worker_crash_smoke=${ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE}
worker_budget_smoke=${ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE}
worker_workflow_smoke=${ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE}
secret_provider_smoke=${ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE}
secret_provider_audit_smoke=${ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE}
external_preflight_smoke=${ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT}
smoke_external=${ACP_SMOKE_EXTERNAL}
smoke_user_write=${ACP_SMOKE_ENABLE_USER_WRITE:-false}
plane_writeback_enabled=${PLANE_WRITEBACK_ENABLED}
plane_writeback_apply=${PLANE_WRITEBACK_SMOKE_APPLY}
openhands_create_conversation=${OPENHANDS_SMOKE_CREATE_CONVERSATION}
openhands_wait_ready=${OPENHANDS_SMOKE_WAIT_READY}
openhands_db_expect_trace_ref=${OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF}
langfuse_enabled=${LANGFUSE_ENABLED}
langfuse_dry_run=${LANGFUSE_SMOKE_DRY_RUN}
worker_crash_temp_db=${WORKER_CRASH_SMOKE_TEMP_DB:-true}
worker_budget_temp_db=${WORKER_BUDGET_SMOKE_TEMP_DB:-true}
worker_workflow_temp_db=${WORKER_WORKFLOW_SMOKE_TEMP_DB:-true}
worker_execution_adapter=${WORKER_EXECUTION_ADAPTER}
EOF
  exit 0
fi

if [[ -e "$ACP_CUTOVER_REPORT_FILE" ]]; then
  echo "completion_final=failed" >&2
  echo "error=ACP_CUTOVER_REPORT_FILE must not already exist for final completion gate" >&2
  exit 1
fi

echo "completion_final=running"
echo "completion_execution_profile=${ACP_COMPLETION_EXECUTION_PROFILE}"
echo "completion_final_run_id=${ACP_COMPLETION_FINAL_RUN_ID}"
echo "external_preflight_id=${ACP_EXTERNAL_PREFLIGHT_ID}"
echo "cutover_report_id=${ACP_CUTOVER_REPORT_ID}"
echo "cutover_report_file=${ACP_CUTOVER_REPORT_FILE}"
echo "completion_audit_report_file=${ACP_COMPLETION_AUDIT_REPORT_FILE}"
echo "secret_env_file=${ACP_SECRET_ENV_FILE:-not-set}"
echo "default_final_env_file=${DEFAULT_FINAL_ENV_FILE}"
echo "default_final_env_file_exists=$(default_final_env_file_exists)"
echo "default_final_env_file_hint=$(default_final_env_file_hint)"
if [[ -z "${ACP_SECRET_ENV_FILE:-}" ]]; then
  echo "next_command_generate_env_template=$(final_env_template_command "$DEFAULT_FINAL_ENV_FILE")"
fi
echo "next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=$(final_env_file_for_next_command) pnpm external:preflight"
echo "next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=$(final_env_file_for_next_command) pnpm completion:gap"
echo "next_command_run_final=ACP_SECRET_ENV_FILE=$(final_env_file_for_next_command) pnpm completion:final"

pnpm --silent external:preflight
pnpm --silent cutover:check
pnpm --silent completion:audit

echo "completion_final=passed"
echo "completion_execution_profile=${ACP_COMPLETION_EXECUTION_PROFILE}"
echo "completion_final_run_id=${ACP_COMPLETION_FINAL_RUN_ID}"
echo "external_preflight_id=${ACP_EXTERNAL_PREFLIGHT_ID}"
echo "cutover_report_id=${ACP_CUTOVER_REPORT_ID}"
