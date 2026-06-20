#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

declare -a ERRORS=()
declare -a WARNINGS=()
PLANE_WRITEBACK_EVIDENCE=""
CODEX_ADAPTER_EVIDENCE=""
OPENHANDS_CONVERSATION_EVIDENCE=""
OPENHANDS_ADAPTER_EVIDENCE=""
OPENHANDS_DB_EVIDENCE=""
LANGFUSE_TRACE_EVIDENCE=""
PRODUCTION_SMOKE_EVIDENCE=""
TASK_SOURCE_EVIDENCE=""
WORKER_CRASH_EVIDENCE=""
WORKER_BUDGET_EVIDENCE=""
WORKER_WORKFLOW_EVIDENCE=""
SECRET_PROVIDER_EVIDENCE=""
SECRET_PROVIDER_AUDIT_EVIDENCE=""
EXTERNAL_PREFLIGHT_EVIDENCE=""

is_codex_execution_adapter() {
  [[ "$1" == "codex-cli" || "$1" == "codex-app-server" ]]
}

write_cutover_report() {
  local readiness="$1"
  local report_file="${ACP_CUTOVER_REPORT_FILE:-}"
  if [[ -z "$report_file" ]]; then
    return
  fi

  local warnings_file
  local errors_file
  warnings_file="$(mktemp)"
  errors_file="$(mktemp)"
  if [[ "${#WARNINGS[@]}" -gt 0 ]]; then
    printf "%s\n" "${WARNINGS[@]}" >"$warnings_file"
  fi
  if [[ "${#ERRORS[@]}" -gt 0 ]]; then
    printf "%s\n" "${ERRORS[@]}" >"$errors_file"
  fi

  PLANE_WRITEBACK_EVIDENCE="$PLANE_WRITEBACK_EVIDENCE" \
    CODEX_ADAPTER_EVIDENCE="$CODEX_ADAPTER_EVIDENCE" \
    OPENHANDS_CONVERSATION_EVIDENCE="$OPENHANDS_CONVERSATION_EVIDENCE" \
    OPENHANDS_ADAPTER_EVIDENCE="$OPENHANDS_ADAPTER_EVIDENCE" \
    OPENHANDS_DB_EVIDENCE="$OPENHANDS_DB_EVIDENCE" \
    LANGFUSE_TRACE_EVIDENCE="$LANGFUSE_TRACE_EVIDENCE" \
    PRODUCTION_SMOKE_EVIDENCE="$PRODUCTION_SMOKE_EVIDENCE" \
    TASK_SOURCE_EVIDENCE="$TASK_SOURCE_EVIDENCE" \
    WORKER_CRASH_EVIDENCE="$WORKER_CRASH_EVIDENCE" \
    WORKER_BUDGET_EVIDENCE="$WORKER_BUDGET_EVIDENCE" \
    WORKER_WORKFLOW_EVIDENCE="$WORKER_WORKFLOW_EVIDENCE" \
    SECRET_PROVIDER_EVIDENCE="$SECRET_PROVIDER_EVIDENCE" \
    SECRET_PROVIDER_AUDIT_EVIDENCE="$SECRET_PROVIDER_AUDIT_EVIDENCE" \
    EXTERNAL_PREFLIGHT_EVIDENCE="$EXTERNAL_PREFLIGHT_EVIDENCE" \
    node - "$report_file" "$readiness" "$warnings_file" "$errors_file" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [reportFile, readiness, warningsFile, errorsFile] = process.argv.slice(2);

function lines(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  return text ? text.split("\n") : [];
}

function bool(name, fallback = "false") {
  return (process.env[name] ?? fallback) === "true";
}

function value(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw : fallback;
}

const report = {
  reportId: value("ACP_CUTOVER_REPORT_ID", `cutover-report-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`),
  generatedAt: new Date().toISOString(),
  completionFinalRunId: value("ACP_COMPLETION_FINAL_RUN_ID", ""),
  readiness,
  errors: lines(errorsFile),
  warnings: lines(warningsFile),
  gates: {
    planeWritebackEnabled: bool("PLANE_WRITEBACK_ENABLED"),
    legacyPollerReadonly: bool("ACP_CUTOVER_LEGACY_POLLER_READONLY"),
    linearArchiveConfirmed: bool("ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED"),
  },
  smoke: {
    production: bool("ACP_CUTOVER_RUN_PRODUCTION_SMOKE"),
    planeWriteback: bool("ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE"),
    codexAdapter: bool("ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE"),
    openhandsConversation: bool("ACP_CUTOVER_RUN_OPENHANDS_SMOKE"),
    openhandsAdapter: bool("ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE"),
    openhandsDbRun: bool("ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE"),
    langfuseTrace: bool("ACP_CUTOVER_RUN_LANGFUSE_SMOKE"),
    taskSource: bool("ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE"),
    workerCrashRecovery: bool("ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE"),
    workerBudget: bool("ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE"),
    workerWorkflow: bool("ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE"),
    secretProvider: bool("ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE"),
    secretProviderAudit: bool("ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE"),
    externalPreflight: bool("ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT"),
  },
  evidence: {
    productionSmoke: value("PRODUCTION_SMOKE_EVIDENCE", "not-run"),
    planeWriteback: value("PLANE_WRITEBACK_EVIDENCE", "recorded"),
    codexAdapter: value("CODEX_ADAPTER_EVIDENCE", "not-run"),
    openhandsConversation: value("OPENHANDS_CONVERSATION_EVIDENCE", "recorded"),
    openhandsAdapter: value("OPENHANDS_ADAPTER_EVIDENCE", "not-run"),
    openhandsDbRun: value("OPENHANDS_DB_EVIDENCE", "not-run"),
    langfuseTrace: value("LANGFUSE_TRACE_EVIDENCE", "recorded"),
    taskSource: value("TASK_SOURCE_EVIDENCE", "recorded"),
    workerCrashRecovery: value("WORKER_CRASH_EVIDENCE", "not-run"),
    workerBudget: value("WORKER_BUDGET_EVIDENCE", "not-run"),
    workerWorkflow: value("WORKER_WORKFLOW_EVIDENCE", "not-run"),
    secretProvider: value("SECRET_PROVIDER_EVIDENCE", "not-run"),
    secretProviderAudit: value("SECRET_PROVIDER_AUDIT_EVIDENCE", "not-run"),
    externalPreflight: value("EXTERNAL_PREFLIGHT_EVIDENCE", "not-run"),
    legacyPoller: value("ACP_CUTOVER_LEGACY_POLLER_EVIDENCE", "recorded"),
    linearArchive: value("ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE", "recorded"),
    manualSummary: value("ACP_CUTOVER_MANUAL_EVIDENCE_SUMMARY", "recorded"),
  },
  config: {
    completionExecutionProfile: value("ACP_COMPLETION_EXECUTION_PROFILE", "codex-cli"),
    workerExecutionAdapter: value("WORKER_EXECUTION_ADAPTER", "codex-cli"),
    langfuseEnabled: bool("LANGFUSE_ENABLED"),
    cutoverSkipSecretValidate: bool("ACP_CUTOVER_SKIP_SECRET_VALIDATE"),
    smokeExternal: bool("ACP_SMOKE_EXTERNAL"),
  },
};

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(reportFile, 0o600);
NODE
  rm -f "$warnings_file" "$errors_file"
}

ensure_cutover_report_file_available() {
  local report_file="${ACP_CUTOVER_REPORT_FILE:-}"
  if [[ -z "$report_file" || ! -e "$report_file" ]]; then
    return
  fi

  if [[ "${ACP_CUTOVER_REPORT_OVERWRITE:-false}" == "true" ]]; then
    return
  fi

  echo "cutover_readiness=failed"
  echo "error: ACP_CUTOVER_REPORT_FILE already exists (${report_file}); set ACP_CUTOVER_REPORT_OVERWRITE=true to replace it" >&2
  exit 1
}

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if is_placeholder_value "$file"; then
    ERRORS+=("ACP_SECRET_ENV_FILE: still contains a template placeholder")
    return
  fi

  if [[ ! -f "$file" ]]; then
    ERRORS+=("ACP_SECRET_ENV_FILE: file not found (${file})")
    return
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    ERRORS+=("ACP_SECRET_ENV_FILE: file permissions must be 600 or 400 (${file})")
    return
  fi

  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    ERRORS+=("ACP_SECRET_ENV_FILE: ${load_error}")
  fi
  rm -f "$load_error_file"
}

load_secret_command() {
  local command="${ACP_SECRET_COMMAND:-}"
  if [[ -z "$command" ]]; then
    return
  fi

  if is_placeholder_value "$command"; then
    ERRORS+=("ACP_SECRET_COMMAND: still contains a template placeholder")
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! bash -c "$command" >"$tmp_file"; then
    rm -f "$tmp_file"
    ERRORS+=("ACP_SECRET_COMMAND: command failed")
    return
  fi

  chmod 600 "$tmp_file"
  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$tmp_file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    ERRORS+=("ACP_SECRET_COMMAND: ${load_error}")
  fi
  rm -f "$load_error_file"
  rm -f "$tmp_file"
}

is_placeholder_value() {
  local value="$1"
  [[ "$value" == *"<"*">"* || "$value" == *"example.com"* || "$value" == *"YYYY-MM-DD"* || "$value" == "owner/repo" ]]
}

is_loopback_url() {
  local value="$1"
  [[ "$value" =~ ^https?://(localhost|127(\.[0-9]{1,3}){0,3}|0\.0\.0\.0|\[?::1\]?)([:/]|$) ]]
}

allow_loopback_urls() {
  [[ "${ACP_CUTOVER_ALLOW_LOOPBACK_URLS:-false}" == "true" ]]
}

require_env() {
  local name="$1"
  local reason="$2"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    ERRORS+=("${name}: missing (${reason})")
  elif is_placeholder_value "$value"; then
    ERRORS+=("${name}: still contains a template placeholder (${reason})")
  fi
}

require_non_loopback_env() {
  local name="$1"
  local reason="$2"
  local value="${!name:-}"
  require_env "$name" "$reason"
  if [[ -n "$value" ]] && ! allow_loopback_urls && is_loopback_url "$value"; then
    ERRORS+=("${name}: must not use loopback URL (${reason})")
  fi
}

require_true() {
  local name="$1"
  local reason="$2"
  if [[ "${!name:-false}" != "true" ]]; then
    ERRORS+=("${name}: must be true (${reason})")
  fi
}

require_evidence() {
  local name="$1"
  local reason="$2"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    ERRORS+=("${name}: missing (${reason})")
  elif is_placeholder_value "$value"; then
    ERRORS+=("${name}: still contains a template placeholder (${reason})")
  fi
}

require_url_evidence() {
  local name="$1"
  local reason="$2"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    ERRORS+=("${name}: missing (${reason})")
    return
  fi

  if is_placeholder_value "$value"; then
    ERRORS+=("${name}: still contains a template placeholder (${reason})")
    return
  fi

  if [[ "$value" != http://* && "$value" != https://* ]]; then
    ERRORS+=("${name}: must be an http(s) URL (${reason})")
  elif ! allow_loopback_urls && is_loopback_url "$value"; then
    ERRORS+=("${name}: must not use loopback URL (${reason})")
  fi
}

record_warning() {
  WARNINGS+=("$1")
}

output_value() {
  local output="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { value = substr($0, length(key) + 2) } END { print value }' <<<"$output"
}

output_value_any() {
  local output="$1"
  shift
  local key value
  for key in "$@"; do
    value="$(output_value "$output" "$key")"
    if [[ -n "$value" ]]; then
      printf "%s\n" "$value"
      return
    fi
  done
  return 0
}

run_smoke_to_file() {
  local label="$1"
  local output_file="$2"
  shift
  shift

  if ! "$@" >"$output_file" 2>&1; then
    ERRORS+=("${label} failed")
    return 1
  fi
}

run_external_preflight() {
  if [[ "${ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT:-false}" != "true" ]]; then
    return
  fi

  local output output_file ready_count missing_count external_preflight_id
  output_file="$(mktemp)"
  run_smoke_to_file "external: preflight" "$output_file" bash scripts/external-smoke-preflight.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  ready_count="$(output_value "$output" "ready_count")"
  missing_count="$(output_value "$output" "missing_count")"
  external_preflight_id="$(output_value "$output" "external_preflight_id")"
  EXTERNAL_PREFLIGHT_EVIDENCE="preflight_id=${external_preflight_id:-unknown};ready_count=${ready_count:-unknown};missing_count=${missing_count:-unknown}"
}

run_production_smoke() {
  if [[ "${ACP_CUTOVER_RUN_PRODUCTION_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output_file
  output_file="$(mktemp)"
  run_smoke_to_file "smoke: production smoke" "$output_file" env \
    ACP_SMOKE_EXTERNAL="${ACP_SMOKE_EXTERNAL:-true}" \
    ACP_SMOKE_ENABLE_USER_WRITE="${ACP_SMOKE_ENABLE_USER_WRITE:-false}" \
    ACP_SMOKE_SKIP_SECRET_VALIDATE="${ACP_SMOKE_SKIP_SECRET_VALIDATE:-${ACP_CUTOVER_SKIP_SECRET_VALIDATE:-false}}" \
    bash scripts/smoke-production.sh || {
      rm -f "$output_file"
      return
    }
  local output base_url plane_probe plane_status openhands_probe openhands_status langfuse_probe langfuse_status
  output="$(cat "$output_file")"
  base_url="$(output_value "$output" "base_url")"
  plane_probe="$(output_value "$output" "external_plane_evidence")"
  plane_status="$(output_value "$output" "external_plane_status")"
  openhands_probe="$(output_value "$output" "external_openhands_evidence")"
  openhands_status="$(output_value "$output" "external_openhands_status")"
  langfuse_probe="$(output_value "$output" "external_langfuse_evidence")"
  langfuse_status="$(output_value "$output" "external_langfuse_status")"
  if [[ -z "$plane_probe" || "$plane_probe" == "not-run" ]]; then
    plane_probe="${base_url%/}/api/readiness"
    plane_status="200"
  fi
  PRODUCTION_SMOKE_EVIDENCE="plane=${plane_probe:-not-run};plane_status=${plane_status:-unknown};openhands=${openhands_probe:-not-run};openhands_status=${openhands_status:-unknown};langfuse=${langfuse_probe:-not-run};langfuse_status=${langfuse_status:-unknown}"
  rm -f "$output_file"
}

run_secret_provider_smoke() {
  if [[ "${ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output output_file variables validation
  output_file="$(mktemp)"
  run_smoke_to_file "secrets: provider smoke" "$output_file" bash scripts/smoke-secret-provider.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  variables="$(output_value "$output" "variables")"
  validation="$(output_value "$output" "validation")"
  SECRET_PROVIDER_EVIDENCE="variables=${variables:-unknown};validation=${validation:-unknown}"
}

run_secret_provider_audit_smoke() {
  if [[ "${ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output output_file source events matched_events newest_event_at
  output_file="$(mktemp)"
  run_smoke_to_file "secrets: provider audit smoke" "$output_file" bash scripts/smoke-secret-provider-audit.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  source="$(output_value "$output" "source")"
  events="$(output_value "$output" "events")"
  matched_events="$(output_value "$output" "matched_events")"
  newest_event_at="$(output_value "$output" "newest_event_at")"
  SECRET_PROVIDER_AUDIT_EVIDENCE="source=${source:-unknown};events=${events:-unknown};matched_events=${matched_events:-unknown};newest_event_at=${newest_event_at:-unknown}"
}

run_plane_writeback_smoke() {
  if [[ "${ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE:-false}" != "true" ]]; then
    return
  fi

  if [[ "${PLANE_WRITEBACK_SMOKE_APPLY:-false}" != "true" ]]; then
    ERRORS+=("plane: writeback smoke requires PLANE_WRITEBACK_SMOKE_APPLY=true")
    return
  fi

  if [[ -z "${PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID:-}" ]]; then
    ERRORS+=("plane: writeback smoke requires PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID")
    return
  fi

  local output output_file work_item_id state comment verified
  output_file="$(mktemp)"
  run_smoke_to_file "plane: writeback smoke" "$output_file" bash scripts/smoke-plane-writeback.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  work_item_id="$(output_value "$output" "work_item_id")"
  state="$(output_value "$output" "state")"
  comment="$(output_value "$output" "comment")"
  verified="$(output_value "$output" "verified")"
  PLANE_WRITEBACK_EVIDENCE="work_item_id=${work_item_id:-unknown};state=${state:-unknown};comment=${comment:-unknown};verified=${verified:-unknown}"
}

run_codex_adapter_smoke() {
  if [[ "${ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local smoke_command output output_file summary next_state events conversation_provider
  if [[ "${WORKER_EXECUTION_ADAPTER:-codex-cli}" == "codex-app-server" ]]; then
    smoke_command="codex:app-server-smoke"
  else
    smoke_command="codex:adapter-smoke"
  fi

  output_file="$(mktemp)"
  run_smoke_to_file "codex: adapter smoke" "$output_file" pnpm --silent "$smoke_command" || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  summary="$(output_value "$output" "summary")"
  next_state="$(output_value "$output" "next_state")"
  events="$(output_value "$output" "events")"
  conversation_provider="$(output_value "$output" "conversation_provider")"
  CODEX_ADAPTER_EVIDENCE="provider=${conversation_provider:-unknown};next_state=${next_state:-unknown};events=${events:-unknown};summary=${summary:-unknown}"
}

run_openhands_smoke() {
  if [[ "${ACP_CUTOVER_RUN_OPENHANDS_SMOKE:-false}" != "true" ]]; then
    return
  fi

  if [[ "${OPENHANDS_SMOKE_CREATE_CONVERSATION:-false}" != "true" ]]; then
    ERRORS+=("openhands: smoke requires OPENHANDS_SMOKE_CREATE_CONVERSATION=true")
    return
  fi

  local output output_file ui_url conversation_id payload_file
  output_file="$(mktemp)"
  run_smoke_to_file "openhands: conversation smoke" "$output_file" bash scripts/smoke-openhands.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  ui_url="$(output_value "$output" "ui_url")"
  conversation_id="$(output_value "$output" "conversation_id")"
  payload_file="$(output_value "$output" "payload_file")"
  OPENHANDS_CONVERSATION_EVIDENCE="ui_url=${ui_url:-unknown};conversation_id=${conversation_id:-unknown}"
  if [[ -n "$payload_file" ]]; then
    OPENHANDS_CONVERSATION_EVIDENCE="${OPENHANDS_CONVERSATION_EVIDENCE};payload_file=${payload_file}"
  fi
}

run_openhands_adapter_smoke() {
  if [[ "${ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output output_file ui_url conversation_id next_state
  output_file="$(mktemp)"
  run_smoke_to_file "openhands: adapter smoke" "$output_file" bash scripts/smoke-openhands-adapter.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  ui_url="$(output_value "$output" "ui_url")"
  conversation_id="$(output_value "$output" "conversation_id")"
  next_state="$(output_value "$output" "next_state")"
  OPENHANDS_ADAPTER_EVIDENCE="ui_url=${ui_url:-unknown};conversation_id=${conversation_id:-unknown};next_state=${next_state:-unknown}"
}

run_openhands_db_smoke() {
  if [[ "${ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output output_file run_id conversation_id ui_url prompt_release_id trace_refs trace_ui_url next_state events
  output_file="$(mktemp)"
  run_smoke_to_file "openhands: database run smoke" "$output_file" bash scripts/smoke-openhands-db.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  run_id="$(output_value "$output" "run_id")"
  conversation_id="$(output_value "$output" "conversation_id")"
  ui_url="$(output_value "$output" "ui_url")"
  prompt_release_id="$(output_value "$output" "prompt_release_id")"
  trace_refs="$(output_value "$output" "trace_refs")"
  trace_ui_url="$(output_value "$output" "trace_ui_url")"
  next_state="$(output_value "$output" "next_state")"
  events="$(output_value "$output" "events")"
  OPENHANDS_DB_EVIDENCE="run_id=${run_id:-unknown};conversation_id=${conversation_id:-unknown};ui_url=${ui_url:-unknown};prompt_release_id=${prompt_release_id:-unknown};trace_refs=${trace_refs:-unknown};trace_ui_url=${trace_ui_url:-unknown};next_state=${next_state:-unknown};events=${events:-unknown}"
}

run_langfuse_smoke() {
  if [[ "${ACP_CUTOVER_RUN_LANGFUSE_SMOKE:-false}" != "true" ]]; then
    return
  fi

  if [[ "${LANGFUSE_SMOKE_DRY_RUN:-false}" == "true" ]]; then
    ERRORS+=("langfuse: cutover smoke must not use LANGFUSE_SMOKE_DRY_RUN=true")
    return
  fi

  local output output_file ui_url trace_id
  output_file="$(mktemp)"
  run_smoke_to_file "langfuse: trace smoke" "$output_file" pnpm --silent langfuse:smoke || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  ui_url="$(output_value "$output" "ui_url")"
  trace_id="$(output_value "$output" "trace_id")"
  if [[ -z "$ui_url" ]]; then
    ERRORS+=("langfuse: trace smoke must output ui_url; configure LANGFUSE_PROJECT_ID and LANGFUSE_BASE_URL")
    return
  fi
  LANGFUSE_TRACE_EVIDENCE="trace_id=${trace_id:-unknown};ui_url=$ui_url"
}

run_task_source_smoke() {
  if [[ "${ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local completion_profile require_conversation_evidence require_trace_evidence
  local require_run_event_evidence require_progress_item_evidence
  completion_profile="${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}"
  if [[ "$completion_profile" == "codex-cli" ]]; then
    require_conversation_evidence="${TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE:-false}"
    require_trace_evidence="${TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE:-false}"
    require_run_event_evidence="${TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE:-true}"
    require_progress_item_evidence="${TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_ITEM_EVIDENCE:-true}"
  else
    require_conversation_evidence="${TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE:-true}"
    require_trace_evidence="${TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE:-true}"
    require_run_event_evidence="${TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE:-false}"
    require_progress_item_evidence="${TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_ITEM_EVIDENCE:-false}"
  fi

  local output output_file checked plane_url_count linear_url_count routed_count run_count run_event_count progress_item_count conversation_count trace_count
  output_file="$(mktemp)"
  run_smoke_to_file "task-source: smoke" "$output_file" env \
    TASK_SOURCE_SMOKE_REQUIRE_SAMPLE="${TASK_SOURCE_SMOKE_REQUIRE_SAMPLE:-true}" \
    TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE="${TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE:-true}" \
    TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE="$require_conversation_evidence" \
    TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE="$require_trace_evidence" \
    TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE="$require_run_event_evidence" \
    TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENTS_EVIDENCE="$require_run_event_evidence" \
    TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_EVIDENCE="$require_progress_item_evidence" \
    TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_ITEM_EVIDENCE="$require_progress_item_evidence" \
    TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_ITEMS_EVIDENCE="$require_progress_item_evidence" \
    bash scripts/smoke-task-source.sh || {
      rm -f "$output_file"
      return
    }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  checked="$(output_value "$output" "checked")"
  plane_url_count="$(output_value "$output" "plane_url_count")"
  linear_url_count="$(output_value "$output" "linear_url_count")"
  routed_count="$(output_value "$output" "routed_count")"
  run_count="$(output_value "$output" "run_evidence_count")"
  run_event_count="$(output_value_any "$output" "run_event_count" "run_events_count" "run_events")"
  progress_item_count="$(output_value_any "$output" "progress_item_count" "progress_items_count" "progress_items")"
  conversation_count="$(output_value "$output" "conversation_evidence_count")"
  trace_count="$(output_value "$output" "trace_evidence_count")"
  TASK_SOURCE_EVIDENCE="checked=${checked:-unknown};plane_urls=${plane_url_count:-unknown};linear_urls=${linear_url_count:-unknown};routed=${routed_count:-unknown};runs=${run_count:-unknown};run_events=${run_event_count:-unknown};progress_items=${progress_item_count:-unknown};conversations=${conversation_count:-unknown};traces=${trace_count:-unknown}"
}

run_worker_crash_smoke() {
  if [[ "${ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output output_file stale_run_id recovered_run_id recovered_attempt next_state
  output_file="$(mktemp)"
  run_smoke_to_file "worker: crash recovery smoke" "$output_file" bash scripts/smoke-worker-crash.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  stale_run_id="$(output_value "$output" "stale_run_id")"
  recovered_run_id="$(output_value "$output" "recovered_run_id")"
  recovered_attempt="$(output_value "$output" "recovered_attempt")"
  next_state="$(output_value "$output" "next_state")"
  WORKER_CRASH_EVIDENCE="stale_run_id=${stale_run_id:-unknown};recovered_run_id=${recovered_run_id:-unknown};recovered_attempt=${recovered_attempt:-unknown};next_state=${next_state:-unknown}"
}

run_worker_budget_smoke() {
  if [[ "${ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output output_file task_id estimated_cost max_cost budget_blocked final_state
  output_file="$(mktemp)"
  run_smoke_to_file "worker: budget smoke" "$output_file" bash scripts/smoke-worker-budget.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  task_id="$(output_value "$output" "task_id")"
  estimated_cost="$(output_value "$output" "estimated_cost_usd")"
  max_cost="$(output_value "$output" "max_estimated_cost_usd_per_run")"
  budget_blocked="$(output_value "$output" "budget_blocked")"
  final_state="$(output_value "$output" "final_state")"
  WORKER_BUDGET_EVIDENCE="task_id=${task_id:-unknown};estimated_cost_usd=${estimated_cost:-unknown};max_estimated_cost_usd_per_run=${max_cost:-unknown};budget_blocked=${budget_blocked:-unknown};final_state=${final_state:-unknown}"
}

run_worker_workflow_smoke() {
  if [[ "${ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE:-false}" != "true" ]]; then
    return
  fi

  local output output_file task_id runs final_state
  output_file="$(mktemp)"
  run_smoke_to_file "worker: workflow smoke" "$output_file" bash scripts/smoke-worker-workflow.sh || {
    rm -f "$output_file"
    return
  }
  output="$(cat "$output_file")"
  rm -f "$output_file"
  task_id="$(output_value "$output" "task_id")"
  runs="$(output_value "$output" "runs")"
  final_state="$(output_value "$output" "final_state")"
  WORKER_WORKFLOW_EVIDENCE="task_id=${task_id:-unknown};runs=${runs:-unknown};final_state=${final_state:-unknown}"
}

load_secret_env_file
load_secret_command
ensure_cutover_report_file_available

bind_manual_evidence_defaults() {
  if [[ -z "$PLANE_WRITEBACK_EVIDENCE" ]]; then
    PLANE_WRITEBACK_EVIDENCE="${ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE:-}"
  fi
  if [[ -z "$OPENHANDS_CONVERSATION_EVIDENCE" ]]; then
    OPENHANDS_CONVERSATION_EVIDENCE="${ACP_CUTOVER_OPENHANDS_CONVERSATION_URL:-}"
  fi
  if [[ -z "$LANGFUSE_TRACE_EVIDENCE" ]]; then
    LANGFUSE_TRACE_EVIDENCE="${ACP_CUTOVER_LANGFUSE_TRACE_URL:-}"
  fi
  if [[ -z "$TASK_SOURCE_EVIDENCE" ]]; then
    TASK_SOURCE_EVIDENCE="${ACP_CUTOVER_TASK_SOURCE_EVIDENCE:-}"
  fi
}

bind_manual_evidence_defaults

require_env "DATABASE_URL" "Control Plane database"
require_non_loopback_env "PLANE_BASE_URL" "Plane API/smoke"
require_env "PLANE_WORKSPACE_SLUG" "Plane API/smoke"
require_env "PLANE_PROJECT_ID" "Plane API/smoke"
require_env "PLANE_API_KEY" "Plane API/smoke"
require_env "PLANE_WEBHOOK_SECRET" "Plane webhook receiver"
require_true "PLANE_WRITEBACK_ENABLED" "cutover requires Plane writeback"
if [[ "${ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE:-false}" != "true" ]]; then
  require_true "ACP_CUTOVER_PLANE_WRITEBACK_SMOKE_PASSED" "manual gate/rework Plane state/comment smoke"
  require_evidence "ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE" "Plane work item state/comment writeback evidence"
fi
if [[ "${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}" != "codex-cli" && "${ACP_CUTOVER_RUN_OPENHANDS_SMOKE:-false}" != "true" ]]; then
  require_true "ACP_CUTOVER_OPENHANDS_SMOKE_PASSED" "real OpenHands conversation smoke"
  require_url_evidence "ACP_CUTOVER_OPENHANDS_CONVERSATION_URL" "real OpenHands conversation URL"
fi
if [[ "${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}" != "codex-cli" && "${ACP_CUTOVER_RUN_LANGFUSE_SMOKE:-false}" != "true" ]]; then
  require_true "ACP_CUTOVER_LANGFUSE_SMOKE_PASSED" "real Langfuse trace smoke"
  require_url_evidence "ACP_CUTOVER_LANGFUSE_TRACE_URL" "real Langfuse trace URL"
fi
if [[ "${ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE:-false}" != "true" ]]; then
  require_true "ACP_CUTOVER_TASK_SOURCE_SMOKE_PASSED" "new tasks are dispatched only from Plane/Control Plane"
  require_evidence "ACP_CUTOVER_TASK_SOURCE_EVIDENCE" "task source audit evidence"
fi
if [[ "${ACP_CUTOVER_RUN_PRODUCTION_SMOKE:-false}" == "true" ]]; then
  require_true "ACP_SMOKE_EXTERNAL" "final cutover production smoke must probe external dependencies"
fi
require_true "ACP_CUTOVER_LEGACY_POLLER_READONLY" "freeze old Linear/Symphony dispatcher before cutover"
require_evidence "ACP_CUTOVER_LEGACY_POLLER_EVIDENCE" "old Linear/Symphony poller readonly/stop evidence"
require_true "ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED" "Linear remains archive-only after cutover"
require_evidence "ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE" "Linear archive-only evidence"

if [[ -z "${ACP_OPERATOR_API_TOKEN:-${CONTROL_PLANE_API_TOKEN:-}}" && -z "${ACP_OPERATOR_LOGIN_PASSWORD:-}" ]]; then
  ERRORS+=("operator auth: configure ACP_OPERATOR_API_TOKEN or ACP_OPERATOR_LOGIN_PASSWORD")
fi

if [[ "${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}" == "codex-cli" ]]; then
  if ! is_codex_execution_adapter "${WORKER_EXECUTION_ADAPTER:-codex-cli}"; then
    record_warning "WORKER_EXECUTION_ADAPTER is not codex-cli or codex-app-server for codex-cli completion profile"
  fi
else
  if [[ "${WORKER_EXECUTION_ADAPTER:-codex-cli}" != "openhands-cloud" ]]; then
    record_warning "WORKER_EXECUTION_ADAPTER is not openhands-cloud; cutover will not use real OpenHands"
  fi
fi

if [[ "${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}" != "codex-cli" && "${LANGFUSE_ENABLED:-false}" != "true" ]]; then
  record_warning "LANGFUSE_ENABLED is not true; cutover will not emit real Langfuse traces"
fi

if [[ "${ACP_CUTOVER_SKIP_SECRET_VALIDATE:-false}" != "true" ]]; then
  ACP_ENV="${ACP_ENV:-production}" bash scripts/validate-secrets.sh >/dev/null || {
    ERRORS+=("secrets: validate-secrets failed")
  }
fi

run_external_preflight
run_production_smoke
run_plane_writeback_smoke
run_codex_adapter_smoke
run_openhands_smoke
run_openhands_adapter_smoke
run_openhands_db_smoke
run_langfuse_smoke
run_task_source_smoke
run_worker_crash_smoke
run_worker_budget_smoke
run_worker_workflow_smoke
run_secret_provider_smoke
run_secret_provider_audit_smoke

if [[ "${#WARNINGS[@]}" -gt 0 ]]; then
  echo "cutover_warnings=${#WARNINGS[@]}"
  for warning in "${WARNINGS[@]}"; do
    echo "warning: ${warning}"
  done
fi

if [[ "${#ERRORS[@]}" -gt 0 ]]; then
  write_cutover_report "failed"
  echo "cutover_readiness=failed"
  for error in "${ERRORS[@]}"; do
    echo "error: ${error}" >&2
  done
  exit 1
fi

write_cutover_report "passed"

cat <<EOF
cutover_readiness=passed
plane_writeback=true
legacy_poller_readonly=true
linear_archive=true
production_smoke=${ACP_CUTOVER_RUN_PRODUCTION_SMOKE:-false}
plane_writeback_smoke=${ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE:-false}
codex_adapter_smoke=${ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE:-false}
openhands_smoke=${ACP_CUTOVER_RUN_OPENHANDS_SMOKE:-false}
openhands_adapter_smoke=${ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE:-false}
openhands_db_smoke=${ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE:-false}
langfuse_smoke=${ACP_CUTOVER_RUN_LANGFUSE_SMOKE:-false}
task_source_smoke=${ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE:-false}
worker_crash_smoke=${ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE:-false}
worker_budget_smoke=${ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE:-false}
worker_workflow_smoke=${ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE:-false}
secret_provider_smoke=${ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE:-false}
secret_provider_audit_smoke=${ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE:-false}
external_preflight_smoke=${ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT:-false}
production_smoke_evidence=${PRODUCTION_SMOKE_EVIDENCE:-not-run}
plane_writeback_evidence=${PLANE_WRITEBACK_EVIDENCE:-recorded}
codex_adapter_evidence=${CODEX_ADAPTER_EVIDENCE:-not-run}
openhands_conversation_evidence=${OPENHANDS_CONVERSATION_EVIDENCE:-recorded}
openhands_adapter_evidence=${OPENHANDS_ADAPTER_EVIDENCE:-not-run}
openhands_db_evidence=${OPENHANDS_DB_EVIDENCE:-not-run}
langfuse_trace_evidence=${LANGFUSE_TRACE_EVIDENCE:-recorded}
task_source_evidence=${TASK_SOURCE_EVIDENCE:-recorded}
worker_crash_evidence=${WORKER_CRASH_EVIDENCE:-not-run}
worker_budget_evidence=${WORKER_BUDGET_EVIDENCE:-not-run}
worker_workflow_evidence=${WORKER_WORKFLOW_EVIDENCE:-not-run}
secret_provider_evidence=${SECRET_PROVIDER_EVIDENCE:-not-run}
secret_provider_audit_evidence=${SECRET_PROVIDER_AUDIT_EVIDENCE:-not-run}
external_preflight_evidence=${EXTERNAL_PREFLIGHT_EVIDENCE:-not-run}
legacy_poller_evidence=${ACP_CUTOVER_LEGACY_POLLER_EVIDENCE:-recorded}
linear_archive_evidence=${ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE:-recorded}
manual_evidence=${ACP_CUTOVER_MANUAL_EVIDENCE_SUMMARY:-recorded}
EOF

if [[ -n "${ACP_CUTOVER_REPORT_FILE:-}" ]]; then
  echo "cutover_report_file=${ACP_CUTOVER_REPORT_FILE}"
fi
