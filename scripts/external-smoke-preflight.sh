#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

EXPLICIT_EXTERNAL_PREFLIGHT_ALLOW_MISSING="${ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING-}"
EXPLICIT_EXTERNAL_PREFLIGHT_ID="${ACP_EXTERNAL_PREFLIGHT_ID-}"
DEFAULT_FINAL_ENV_FILE=".secrets/completion-final.env"
declare -a MISSING=()
declare -a READY=()

final_env_file_for_next_command() {
  if [[ -n "${ACP_SECRET_ENV_FILE:-}" ]]; then
    printf '%s' "$ACP_SECRET_ENV_FILE"
    return
  fi

  printf '%s' "$DEFAULT_FINAL_ENV_FILE"
}

final_env_template_command() {
  local final_env_file="$1"
  if [[ -f "$final_env_file" ]]; then
    printf 'ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=%s ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template' "$final_env_file"
  else
    printf 'ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=%s pnpm completion:final-env-template' "$final_env_file"
  fi
}

write_report() {
  local status="$1"
  local report_file="${ACP_EXTERNAL_PREFLIGHT_REPORT_FILE:-}"
  if [[ -z "$report_file" ]]; then
    return
  fi

  local report_dir data_file
  report_dir="$(dirname "$report_file")"
  mkdir -p "$report_dir"
  data_file="$(mktemp)"
  for ((index = 0; index < ${#READY[@]}; index += 1)); do
    printf 'ready\t%s\n' "${READY[$index]}" >>"$data_file"
  done
  for ((index = 0; index < ${#MISSING[@]}; index += 1)); do
    printf 'missing\t%s\n' "${MISSING[$index]}" >>"$data_file"
  done

  local final_env_file final_env_template_command_value
  final_env_file="$(final_env_file_for_next_command)"
  final_env_template_command_value="$(final_env_template_command "$final_env_file")"

  node - "$report_file" "$data_file" "$EXTERNAL_PREFLIGHT_ID" "$status" "$final_env_file" "$final_env_template_command_value" <<'NODE'
const fs = require("node:fs");
const [reportFile, dataFile, preflightId, status, finalEnvFile, finalEnvTemplateCommand] = process.argv.slice(2);
const executionProfile = process.env.ACP_COMPLETION_EXECUTION_PROFILE || "codex-cli";
const lines = fs.readFileSync(dataFile, "utf8").split("\n").filter(Boolean);
const ready = [];
const missing = [];
for (const line of lines) {
  const separator = line.indexOf("\t");
  if (separator < 0) continue;
  const kind = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (kind === "ready") ready.push(value);
  if (kind === "missing") missing.push(value);
}
const report = {
  preflightId,
  executionProfile,
  generatedAt: new Date().toISOString(),
  status,
  ready,
  missing,
  checks: buildChecks(ready, missing),
  scopeSummary: buildScopeSummary(ready, missing),
  nextCommands: buildNextCommands(finalEnvFile, executionProfile),
  readyCount: ready.length,
  missingCount: missing.length,
};

function buildNextCommands(finalEnvFile, executionProfile) {
  const workerExecutionAdapter = process.env.WORKER_EXECUTION_ADAPTER || "codex-cli";
  const commands = [
    finalEnvTemplateCommand,
    `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm completion:gap`,
    `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm external:preflight`,
    "pnpm smoke:production",
  ];
  if (executionProfile === "codex-cli") {
    commands.push(
      workerExecutionAdapter === "codex-app-server"
        ? "pnpm codex:app-server-smoke"
        : "pnpm codex:adapter-smoke",
    );
  } else {
    commands.push(
      "pnpm openhands:smoke",
      "pnpm openhands:adapter-smoke",
      "pnpm openhands:db-smoke",
      "pnpm langfuse:smoke",
    );
  }
  commands.push(
    "pnpm plane:writeback-smoke",
    "pnpm task-source:smoke",
    "pnpm secrets:provider-smoke",
    "pnpm secrets:provider-audit-smoke",
    `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm completion:final`,
  );
  return commands;
}

function buildChecks(ready, missing) {
  const checks = new Map();
  for (const scope of ready) {
    checks.set(scope, { scope, status: "ready", missing: [] });
  }
  for (const item of missing) {
    const separator = item.indexOf(":");
    const scope = separator > 0 ? item.slice(0, separator).trim() : "unknown";
    const check = checks.get(scope) ?? { scope, status: "ready", missing: [] };
    check.status = "missing";
    check.missing.push(item);
    checks.set(scope, check);
  }
  return Array.from(checks.values()).sort((left, right) => left.scope.localeCompare(right.scope));
}

function buildScopeSummary(ready, missing) {
  return buildChecks(ready, missing).map((check) => ({
    scope: check.scope,
    status: check.status,
    ready: check.status === "ready" ? 1 : 0,
    missing: check.missing.length,
  }));
}

fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
NODE
  rm -f "$data_file"
  chmod 600 "$report_file"
}

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if is_placeholder_value "$file"; then
    MISSING+=("secret_env_file: ACP_SECRET_ENV_FILE still contains a template placeholder")
    return
  fi

  if [[ ! -f "$file" ]]; then
    MISSING+=("secret_env_file: ACP_SECRET_ENV_FILE not found")
    return
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    MISSING+=("secret_env_file: ACP_SECRET_ENV_FILE permissions must be 600 or 400")
    return
  fi

  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    MISSING+=("secret_env_file: ${load_error}")
  fi
  rm -f "$load_error_file"
}

load_secret_command() {
  local command="${ACP_SECRET_COMMAND:-}"
  if [[ -z "$command" ]]; then
    return
  fi

  if is_placeholder_value "$command"; then
    MISSING+=("secret_command: ACP_SECRET_COMMAND still contains a template placeholder")
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! bash -c "$command" >"$tmp_file"; then
    rm -f "$tmp_file"
    MISSING+=("secret_command: ACP_SECRET_COMMAND failed")
    return
  fi

  chmod 600 "$tmp_file"
  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$tmp_file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    MISSING+=("secret_command: ${load_error}")
  fi
  rm -f "$load_error_file"
  rm -f "$tmp_file"
}

missing_var() {
  local scope="$1"
  local name="$2"
  local reason="$3"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    MISSING+=("${scope}: ${name} missing (${reason})")
  fi
}

missing_true() {
  local scope="$1"
  local name="$2"
  local reason="$3"
  if [[ "${!name:-false}" != "true" ]]; then
    MISSING+=("${scope}: ${name} must be true (${reason})")
  fi
}

missing_false() {
  local scope="$1"
  local name="$2"
  local reason="$3"
  if [[ "${!name:-false}" == "true" ]]; then
    MISSING+=("${scope}: ${name} must not be true (${reason})")
  fi
}

missing_not_false() {
  local scope="$1"
  local name="$2"
  local reason="$3"
  if [[ "${!name:-true}" == "false" ]]; then
    MISSING+=("${scope}: ${name} must not be false (${reason})")
  fi
}

missing_eq() {
  local scope="$1"
  local name="$2"
  local expected="$3"
  local reason="$4"
  if [[ "${!name:-}" != "$expected" ]]; then
    MISSING+=("${scope}: ${name} must be ${expected} (${reason})")
  fi
}

missing_in() {
  local scope="$1"
  local name="$2"
  local expected_description="$3"
  local reason="$4"
  shift 4

  local value="${!name:-}"
  local expected
  for expected in "$@"; do
    if [[ "$value" == "$expected" ]]; then
      return
    fi
  done

  MISSING+=("${scope}: ${name} must be ${expected_description} (${reason})")
}

has_auth() {
  [[ -n "${ACP_OPERATOR_API_TOKEN:-${CONTROL_PLANE_API_TOKEN:-}}" || -n "${ACP_OPERATOR_LOGIN_PASSWORD:-}" ]]
}

is_placeholder_value() {
  local value="$1"
  [[ "$value" == *"<"*">"* || "$value" == *"example.com"* || "$value" == *"YYYY-MM-DD"* || "$value" == "owner/repo" ]]
}

is_loopback_url() {
  local value="$1"
  [[ "$value" =~ ^https?://(localhost|127(\.[0-9]{1,3}){0,3}|0\.0\.0\.0|\[?::1\]?)([:/]|$) ]]
}

missing_placeholder() {
  local scope="$1"
  local name="$2"
  local reason="$3"
  local value="${!name:-}"
  if [[ -n "$value" ]] && is_placeholder_value "$value"; then
    MISSING+=("${scope}: ${name} still contains a template placeholder (${reason})")
  fi
}

missing_non_loopback_url() {
  local scope="$1"
  local name="$2"
  local reason="$3"
  local value="${!name:-}"
  if [[ -n "$value" ]] && is_loopback_url "$value"; then
    MISSING+=("${scope}: ${name} must not use loopback URL (${reason})")
  fi
}

missing_auth_placeholder() {
  local scope="$1"
  local reason="$2"
  local token="${ACP_OPERATOR_API_TOKEN:-${CONTROL_PLANE_API_TOKEN:-}}"
  local password="${ACP_OPERATOR_LOGIN_PASSWORD:-}"
  local session_secret="${ACP_OPERATOR_SESSION_SECRET:-}"
  if [[ -n "$token" ]] && is_placeholder_value "$token"; then
    MISSING+=("${scope}: operator token still contains a template placeholder (${reason})")
  fi
  if [[ -n "$password" ]] && is_placeholder_value "$password"; then
    MISSING+=("${scope}: ACP_OPERATOR_LOGIN_PASSWORD still contains a template placeholder (${reason})")
  fi
  if [[ -n "$session_secret" ]] && is_placeholder_value "$session_secret"; then
    MISSING+=("${scope}: ACP_OPERATOR_SESSION_SECRET still contains a template placeholder (${reason})")
  fi
}

record_ready_if_clean() {
  local scope="$1"
  local before_count="$2"
  if [[ "${#MISSING[@]}" -eq "$before_count" ]]; then
    READY+=("$scope")
  fi
}

load_secret_env_file
load_secret_command

if [[ -n "${ACP_COMPLETION_EXECUTION_PROFILE:-}" ]]; then
  COMPLETION_EXECUTION_PROFILE="$ACP_COMPLETION_EXECUTION_PROFILE"
elif [[ "${WORKER_EXECUTION_ADAPTER:-}" == "openhands-cloud" ]]; then
  COMPLETION_EXECUTION_PROFILE="openhands-cloud"
else
  COMPLETION_EXECUTION_PROFILE="codex-cli"
fi
case "$COMPLETION_EXECUTION_PROFILE" in
  codex-cli | openhands-cloud | openhands-langfuse | external) ;;
  *)
    MISSING+=("execution_profile: ACP_COMPLETION_EXECUTION_PROFILE must be codex-cli, openhands-cloud, openhands-langfuse, or external")
    ;;
esac
export ACP_COMPLETION_EXECUTION_PROFILE="$COMPLETION_EXECUTION_PROFILE"

legacy_execution_profile() {
  [[ "$COMPLETION_EXECUTION_PROFILE" == "openhands-cloud" || "$COMPLETION_EXECUTION_PROFILE" == "openhands-langfuse" || "$COMPLETION_EXECUTION_PROFILE" == "external" ]]
}

ALLOW_MISSING="${EXPLICIT_EXTERNAL_PREFLIGHT_ALLOW_MISSING:-${ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING:-false}}"
EXTERNAL_PREFLIGHT_ID="${EXPLICIT_EXTERNAL_PREFLIGHT_ID:-${ACP_EXTERNAL_PREFLIGHT_ID:-external-preflight-$(date -u +%Y%m%dT%H%M%SZ)-$$}}"

if legacy_execution_profile || [[ "${ACP_CUTOVER_RUN_PRODUCTION_SMOKE:-false}" == "true" ]]; then
  before="${#MISSING[@]}"
  missing_var "production_smoke" "ACP_SMOKE_BASE_URL" "Control Plane base URL for production smoke"
  if ! has_auth; then
    MISSING+=("production_smoke: ACP_OPERATOR_API_TOKEN or ACP_OPERATOR_LOGIN_PASSWORD missing (operator auth)")
  fi
  missing_placeholder "production_smoke" "ACP_SMOKE_BASE_URL" "replace final env template values before preflight"
  missing_non_loopback_url "production_smoke" "ACP_SMOKE_BASE_URL" "final production smoke must probe an externally reachable Control Plane URL"
  missing_auth_placeholder "production_smoke" "replace final env template values before preflight"
  record_ready_if_clean "production_smoke" "$before"
fi

before="${#MISSING[@]}"
missing_var "plane_writeback" "PLANE_BASE_URL" "Plane API"
missing_var "plane_writeback" "PLANE_WORKSPACE_SLUG" "Plane workspace"
missing_var "plane_writeback" "PLANE_PROJECT_ID" "Plane project"
missing_var "plane_writeback" "PLANE_API_KEY" "Plane API"
missing_true "plane_writeback" "PLANE_WRITEBACK_SMOKE_APPLY" "real writeback smoke must not be dry-run"
missing_var "plane_writeback" "PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID" "test work item to mutate and verify"
missing_placeholder "plane_writeback" "PLANE_BASE_URL" "replace final env template values before preflight"
missing_placeholder "plane_writeback" "PLANE_WORKSPACE_SLUG" "replace final env template values before preflight"
missing_placeholder "plane_writeback" "PLANE_PROJECT_ID" "replace final env template values before preflight"
missing_placeholder "plane_writeback" "PLANE_API_KEY" "replace final env template values before preflight"
missing_placeholder "plane_writeback" "PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID" "replace final env template values before preflight"
missing_non_loopback_url "plane_writeback" "PLANE_BASE_URL" "final Plane writeback smoke must target a real Plane URL"
record_ready_if_clean "plane_writeback" "$before"

if [[ "$COMPLETION_EXECUTION_PROFILE" == "codex-cli" ]]; then
  before="${#MISSING[@]}"
  missing_in "codex_adapter" "WORKER_EXECUTION_ADAPTER" "codex-cli or codex-app-server" "final cutover must use a Codex execution adapter" "codex-cli" "codex-app-server"
  missing_true "codex_adapter" "ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE" "final cutover must run Codex adapter smoke"
  record_ready_if_clean "codex_adapter" "$before"
else
  before="${#MISSING[@]}"
  missing_var "openhands_conversation" "OPENHANDS_BASE_URL" "OpenHands API"
  missing_var "openhands_conversation" "OPENHANDS_API_KEY" "OpenHands API"
  missing_var "openhands_conversation" "OPENHANDS_SELECTED_REPOSITORY" "repository available to OpenHands"
  missing_var "openhands_conversation" "OPENHANDS_SMOKE_PAYLOAD_FILE" "raw payload capture file for parser calibration"
  missing_true "openhands_conversation" "OPENHANDS_SMOKE_CREATE_CONVERSATION" "real conversation smoke"
  missing_true "openhands_conversation" "OPENHANDS_SMOKE_WAIT_READY" "real conversation smoke must wait for ready state"
  missing_placeholder "openhands_conversation" "OPENHANDS_BASE_URL" "replace final env template values before preflight"
  missing_placeholder "openhands_conversation" "OPENHANDS_API_KEY" "replace final env template values before preflight"
  missing_placeholder "openhands_conversation" "OPENHANDS_SELECTED_REPOSITORY" "replace final env template values before preflight"
  missing_placeholder "openhands_conversation" "OPENHANDS_SMOKE_PAYLOAD_FILE" "replace final env template values before preflight"
  missing_non_loopback_url "openhands_conversation" "OPENHANDS_BASE_URL" "final OpenHands conversation smoke must target a real OpenHands URL"
  record_ready_if_clean "openhands_conversation" "$before"

  before="${#MISSING[@]}"
  missing_var "openhands_db_run" "DATABASE_URL" "Control Plane database"
  missing_var "openhands_db_run" "OPENHANDS_BASE_URL" "OpenHands API"
  missing_var "openhands_db_run" "OPENHANDS_API_KEY" "OpenHands API"
  missing_var "openhands_db_run" "OPENHANDS_SELECTED_REPOSITORY" "repository available to OpenHands"
  missing_true "openhands_db_run" "OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF" "completion audit requires positive DB trace_refs and trace_ui_url"
  missing_true "openhands_db_run" "LANGFUSE_ENABLED" "DB run trace refs must be backed by Langfuse tracing"
  missing_placeholder "openhands_db_run" "DATABASE_URL" "replace final env template values before preflight"
  missing_placeholder "openhands_db_run" "OPENHANDS_BASE_URL" "replace final env template values before preflight"
  missing_placeholder "openhands_db_run" "OPENHANDS_API_KEY" "replace final env template values before preflight"
  missing_placeholder "openhands_db_run" "OPENHANDS_SELECTED_REPOSITORY" "replace final env template values before preflight"
  missing_non_loopback_url "openhands_db_run" "OPENHANDS_BASE_URL" "final OpenHands DB smoke must target a real OpenHands URL"
  record_ready_if_clean "openhands_db_run" "$before"

  before="${#MISSING[@]}"
  missing_true "langfuse_trace" "LANGFUSE_ENABLED" "real trace smoke"
  missing_var "langfuse_trace" "LANGFUSE_BASE_URL" "Langfuse API"
  missing_var "langfuse_trace" "LANGFUSE_PROJECT_ID" "Langfuse UI trace URL"
  missing_var "langfuse_trace" "LANGFUSE_PUBLIC_KEY" "Langfuse credentials"
  missing_var "langfuse_trace" "LANGFUSE_SECRET_KEY" "Langfuse credentials"
  missing_false "langfuse_trace" "LANGFUSE_SMOKE_DRY_RUN" "real trace smoke must not use dry-run"
  missing_placeholder "langfuse_trace" "LANGFUSE_BASE_URL" "replace final env template values before preflight"
  missing_placeholder "langfuse_trace" "LANGFUSE_PROJECT_ID" "replace final env template values before preflight"
  missing_placeholder "langfuse_trace" "LANGFUSE_PUBLIC_KEY" "replace final env template values before preflight"
  missing_placeholder "langfuse_trace" "LANGFUSE_SECRET_KEY" "replace final env template values before preflight"
  missing_non_loopback_url "langfuse_trace" "LANGFUSE_BASE_URL" "final Langfuse smoke must target a real Langfuse URL"
  record_ready_if_clean "langfuse_trace" "$before"
fi

before="${#MISSING[@]}"
missing_var "task_source" "DATABASE_URL" "Control Plane database"
missing_var "task_source" "PLANE_BASE_URL" "Plane URL expected in task source audit"
missing_placeholder "task_source" "DATABASE_URL" "replace final env template values before preflight"
missing_placeholder "task_source" "PLANE_BASE_URL" "replace final env template values before preflight"
missing_non_loopback_url "task_source" "PLANE_BASE_URL" "final task-source evidence must point at a real Plane URL"
record_ready_if_clean "task_source" "$before"

before="${#MISSING[@]}"
if [[ -z "${ACP_SECRET_COMMAND:-}" ]]; then
  MISSING+=("secret_provider: ACP_SECRET_COMMAND missing")
fi
missing_placeholder "secret_provider" "ACP_SECRET_COMMAND" "replace final env template values before preflight"
record_ready_if_clean "secret_provider" "$before"

before="${#MISSING[@]}"
if [[ -z "${SECRET_PROVIDER_AUDIT_FILE:-}" && -z "${SECRET_PROVIDER_AUDIT_COMMAND:-}" ]]; then
  MISSING+=("secret_provider_audit: SECRET_PROVIDER_AUDIT_FILE or SECRET_PROVIDER_AUDIT_COMMAND missing")
fi
missing_placeholder "secret_provider_audit" "SECRET_PROVIDER_AUDIT_FILE" "replace final env template values before preflight"
missing_placeholder "secret_provider_audit" "SECRET_PROVIDER_AUDIT_COMMAND" "replace final env template values before preflight"
record_ready_if_clean "secret_provider_audit" "$before"

before="${#MISSING[@]}"
missing_var "cutover_gate" "DATABASE_URL" "Control Plane database"
missing_var "cutover_gate" "PLANE_BASE_URL" "Plane API"
missing_var "cutover_gate" "PLANE_WORKSPACE_SLUG" "Plane workspace"
missing_var "cutover_gate" "PLANE_PROJECT_ID" "Plane project"
missing_var "cutover_gate" "PLANE_API_KEY" "Plane API"
missing_var "cutover_gate" "PLANE_WEBHOOK_SECRET" "Plane webhook verification"
missing_var "cutover_gate" "ACP_OPERATOR_API_TOKEN" "strict secret validation requires API token"
missing_var "cutover_gate" "ACP_OPERATOR_LOGIN_PASSWORD" "strict secret validation requires browser login"
missing_var "cutover_gate" "ACP_OPERATOR_SESSION_SECRET" "strict secret validation requires signed session secret"
missing_true "cutover_gate" "PLANE_WRITEBACK_ENABLED" "cutover requires Plane writeback"
missing_var "cutover_gate" "ACP_CUTOVER_REPORT_FILE" "machine-readable cutover report for completion audit"
missing_var "cutover_gate" "ACP_COMPLETION_FINAL_RUN_ID" "bind cutover report to a final completion invocation"
missing_var "cutover_gate" "ACP_CUTOVER_REPORT_ID" "bind cutover report id to the final completion invocation"
if legacy_execution_profile; then
  missing_true "cutover_gate" "ACP_CUTOVER_RUN_PRODUCTION_SMOKE" "final cutover must run production smoke"
fi
missing_true "cutover_gate" "ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE" "final cutover must run Plane writeback smoke"
if [[ "$COMPLETION_EXECUTION_PROFILE" == "codex-cli" ]]; then
  missing_true "cutover_gate" "ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE" "final cutover must run Codex adapter smoke"
  missing_in "cutover_gate" "WORKER_EXECUTION_ADAPTER" "codex-cli or codex-app-server" "final cutover must use a Codex execution adapter" "codex-cli" "codex-app-server"
else
  missing_true "cutover_gate" "ACP_CUTOVER_RUN_OPENHANDS_SMOKE" "final cutover must run OpenHands conversation smoke"
  missing_true "cutover_gate" "ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE" "final cutover must run OpenHands adapter smoke"
  missing_true "cutover_gate" "ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE" "final cutover must run OpenHands DB run smoke"
  missing_true "cutover_gate" "ACP_CUTOVER_RUN_LANGFUSE_SMOKE" "final cutover must run Langfuse trace smoke"
  missing_eq "cutover_gate" "WORKER_EXECUTION_ADAPTER" "openhands-cloud" "final cutover must use real OpenHands adapter"
  missing_true "cutover_gate" "OPENHANDS_SMOKE_CREATE_CONVERSATION" "final cutover must create a real OpenHands conversation"
  missing_true "cutover_gate" "OPENHANDS_SMOKE_WAIT_READY" "final cutover must wait for OpenHands conversation readiness"
  missing_true "cutover_gate" "OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF" "final cutover DB smoke must require trace refs"
  missing_false "cutover_gate" "LANGFUSE_SMOKE_DRY_RUN" "final cutover must emit a real Langfuse trace"
fi
missing_true "cutover_gate" "ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE" "final cutover must run task-source smoke"
missing_true "cutover_gate" "ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE" "final cutover must run worker crash smoke"
missing_true "cutover_gate" "ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE" "final cutover must run worker budget smoke"
missing_true "cutover_gate" "ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE" "final cutover must run worker workflow smoke"
missing_true "cutover_gate" "ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE" "final cutover must run secret provider smoke"
missing_true "cutover_gate" "ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE" "final cutover must run provider audit smoke"
missing_true "cutover_gate" "ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT" "final cutover must record external preflight evidence"
if legacy_execution_profile || [[ "${ACP_SMOKE_EXTERNAL:-false}" == "true" ]]; then
  missing_true "cutover_gate" "ACP_SMOKE_EXTERNAL" "production smoke must probe external dependencies"
fi
missing_true "cutover_gate" "PLANE_WRITEBACK_SMOKE_APPLY" "final cutover must mutate and verify a Plane test work item"
missing_not_false "cutover_gate" "WORKER_CRASH_SMOKE_TEMP_DB" "final cutover worker crash smoke must use an isolated temp DB"
missing_not_false "cutover_gate" "WORKER_BUDGET_SMOKE_TEMP_DB" "final cutover worker budget smoke must use an isolated temp DB"
missing_not_false "cutover_gate" "WORKER_WORKFLOW_SMOKE_TEMP_DB" "final cutover worker workflow smoke must use an isolated temp DB"
missing_false "cutover_gate" "ACP_CUTOVER_SKIP_SECRET_VALIDATE" "final cutover must run secret validate"
missing_true "cutover_gate" "ACP_CUTOVER_LEGACY_POLLER_READONLY" "legacy poller must be explicitly confirmed readonly before cutover"
missing_var "cutover_gate" "ACP_CUTOVER_LEGACY_POLLER_EVIDENCE" "old Linear/Symphony poller readonly evidence"
missing_true "cutover_gate" "ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED" "Linear archive-only mode must be explicitly confirmed before cutover"
missing_var "cutover_gate" "ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE" "Linear archive-only evidence"
missing_placeholder "cutover_gate" "DATABASE_URL" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "PLANE_BASE_URL" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "PLANE_WORKSPACE_SLUG" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "PLANE_PROJECT_ID" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "PLANE_API_KEY" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "PLANE_WEBHOOK_SECRET" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_OPERATOR_API_TOKEN" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_OPERATOR_LOGIN_PASSWORD" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_OPERATOR_SESSION_SECRET" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_CUTOVER_REPORT_FILE" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_COMPLETION_FINAL_RUN_ID" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_EXTERNAL_PREFLIGHT_ID" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_CUTOVER_REPORT_ID" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_CUTOVER_LEGACY_POLLER_EVIDENCE" "replace final env template values before preflight"
missing_placeholder "cutover_gate" "ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE" "replace final env template values before preflight"
missing_non_loopback_url "cutover_gate" "PLANE_BASE_URL" "final cutover must target a real Plane URL"
missing_auth_placeholder "cutover_gate" "replace final env template values before preflight"
record_ready_if_clean "cutover_gate" "$before"

for ((index = 0; index < ${#READY[@]}; index += 1)); do
  echo "ready=${READY[$index]}"
done

for ((index = 0; index < ${#MISSING[@]}; index += 1)); do
  echo "missing=${MISSING[$index]}"
done

echo "ready_count=${#READY[@]}"
echo "missing_count=${#MISSING[@]}"
echo "external_preflight_id=${EXTERNAL_PREFLIGHT_ID}"

if [[ "${#MISSING[@]}" -gt 0 ]]; then
  write_report "failed"
  echo "external_smoke_preflight=failed"
  if [[ "$ALLOW_MISSING" == "true" ]]; then
    exit 0
  fi
  exit 1
fi

write_report "passed"
echo "external_smoke_preflight=passed"
