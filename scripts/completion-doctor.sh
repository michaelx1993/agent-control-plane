#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

DOCTOR_ID="${ACP_COMPLETION_DOCTOR_ID:-completion-doctor-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-completion-doctor.XXXXXX")"
GAP_OUTPUT_FILE="$TMP_DIR/completion-gap.out"
GAP_REPORT_FILE="${ACP_COMPLETION_DOCTOR_GAP_REPORT_FILE:-reports/${DOCTOR_ID}.gap.json}"
GAP_VARIABLES_FILE="${ACP_COMPLETION_DOCTOR_GAP_VARIABLES_FILE:-reports/${DOCTOR_ID}.variables.txt}"
GAP_MATRIX_FILE="${ACP_COMPLETION_DOCTOR_GAP_VARIABLE_MATRIX_FILE:-reports/${DOCTOR_ID}.variables.tsv}"
GAP_CHECKLIST_FILE="${ACP_COMPLETION_DOCTOR_GAP_CHECKLIST_FILE:-reports/${DOCTOR_ID}.checklist.md}"
GAP_ACTION_PLAN_FILE="${ACP_COMPLETION_DOCTOR_GAP_ACTION_PLAN_FILE:-reports/${DOCTOR_ID}.action-plan.md}"
DEFAULT_SECRET_ENV_FILE="${ACP_COMPLETION_DOCTOR_DEFAULT_ENV_FILE:-.secrets/completion-final.env}"
SECRET_ENV_FILE="${ACP_SECRET_ENV_FILE:-$DEFAULT_SECRET_ENV_FILE}"
PROBE_TIMEOUT_SECONDS="${ACP_COMPLETION_DOCTOR_PROBE_TIMEOUT_SECONDS:-2}"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

is_placeholder_value() {
  local value="$1"
  [[ "$value" == *"<"*">"* || "$value" == *"example.com"* || "$value" == *"YYYY-MM-DD"* || "$value" == "owner/repo" ]]
}

read_env_value() {
  local name="$1"
  if [[ ! -f "$SECRET_ENV_FILE" ]]; then
    return
  fi

  node - "$SECRET_ENV_FILE" "$name" <<'NODE'
const fs = require("node:fs");
const [file, name] = process.argv.slice(2);
const content = fs.readFileSync(file, "utf8");
for (const line of content.split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || match[1] !== name) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  process.stdout.write(value);
  process.exit(0);
}
NODE
}

env_value_status() {
  local name="$1"
  local value
  value="$(read_env_value "$name" || true)"
  if [[ -z "$value" ]]; then
    printf 'missing'
  elif is_placeholder_value "$value"; then
    printf 'placeholder'
  else
    printf 'set'
  fi
}

optional_env_value_status() {
  local name="$1"
  local status
  status="$(env_value_status "$name")"
  if uses_legacy_external_profile; then
    printf '%s' "$status"
  else
    printf 'optional_%s' "$status"
  fi
}

uses_legacy_external_profile() {
  [[ "$execution_profile" == "legacy-openhands" ||
    "$execution_profile" == "openhands-cloud" ||
    "$execution_profile" == "openhands-langfuse" ||
    "$execution_profile" == "external" ]]
}

env_true_status() {
  local name="$1"
  local value
  value="$(read_env_value "$name" || true)"
  if [[ -z "$value" ]]; then
    printf 'missing'
  elif is_placeholder_value "$value"; then
    printf 'placeholder'
  elif [[ "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" == "true" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

probe_url_status_into() {
  local result_var="$1"
  local status_var="$2"
  local url="$1"
  url="$3"
  printf -v "$status_var" '%s' ""
  if [[ -z "$url" || "$url" == "missing" || "$url" == "placeholder" ]]; then
    printf -v "$result_var" '%s' "skipped"
    return
  fi

  local status
  status="$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time "$PROBE_TIMEOUT_SECONDS" "$url" 2>/dev/null || true)"
  printf -v "$status_var" '%s' "$status"
  if [[ "$status" =~ ^(2|3) ]]; then
    printf -v "$result_var" '%s' "reachable"
  elif [[ -n "$status" && "$status" != "000" ]]; then
    printf -v "$result_var" '%s' "unexpected_status"
  else
    printf -v "$result_var" '%s' "unreachable"
  fi
}

mkdir -p "$(dirname "$GAP_REPORT_FILE")" "$(dirname "$GAP_VARIABLES_FILE")" "$(dirname "$GAP_MATRIX_FILE")" "$(dirname "$GAP_CHECKLIST_FILE")" "$(dirname "$GAP_ACTION_PLAN_FILE")"

env \
  ACP_COMPLETION_GAP_ID="$DOCTOR_ID" \
  ACP_COMPLETION_GAP_REPORT_FILE="$GAP_REPORT_FILE" \
  ACP_COMPLETION_GAP_VARIABLES_FILE="$GAP_VARIABLES_FILE" \
  ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE="$GAP_MATRIX_FILE" \
  ACP_COMPLETION_GAP_CHECKLIST_FILE="$GAP_CHECKLIST_FILE" \
  ACP_COMPLETION_GAP_ACTION_PLAN_FILE="$GAP_ACTION_PLAN_FILE" \
  ACP_COMPLETION_GAP_DEFAULT_ENV_FILE="$DEFAULT_SECRET_ENV_FILE" \
  pnpm --silent completion:gap >"$GAP_OUTPUT_FILE"

gap_status="$(awk -F= '$1 == "completion_gap_status" { print $2 }' "$GAP_OUTPUT_FILE")"
ready_count="$(awk -F= '$1 == "ready_count" { print $2 }' "$GAP_OUTPUT_FILE")"
missing_count="$(awk -F= '$1 == "missing_count" { print $2 }' "$GAP_OUTPUT_FILE")"
manual_missing_variables_count="$(awk -F= '$1 == "manual_missing_variables_count" { print $2 }' "$GAP_OUTPUT_FILE")"
manual_required_variables="$(awk -F= '$1 == "manual_missing_required_variables" { print $2 }' "$GAP_OUTPUT_FILE")"
manual_placeholder_variables="$(awk -F= '$1 == "manual_placeholder_variables" { print $2 }' "$GAP_OUTPUT_FILE")"
manual_not_true_variables="$(awk -F= '$1 == "manual_not_true_variables" { print $2 }' "$GAP_OUTPUT_FILE")"
auto_bound_variables="$(awk -F= '$1 == "completion_final_auto_bound_missing_variables" { print $2 }' "$GAP_OUTPUT_FILE")"
next_command_generate_env_template="$(sed -n 's/^next_command_generate_env_template=//p' "$GAP_OUTPUT_FILE" | tail -n 1)"
gap_scope_summary="$(awk -F'[=;]' '$1 == "scope" { printf "%s%s:%s:%s:%s", separator, $2, $4, $6, $8; separator="," }' "$GAP_OUTPUT_FILE")"
gap_scope_status_lines="$(awk -F'[=;]' '$1 == "scope" { scope=$2; gsub(/[^A-Za-z0-9_]/, "_", scope); print "gap_scope_" scope "_status=" $4; print "gap_scope_" scope "_ready=" $6; print "gap_scope_" scope "_missing=" $8 }' "$GAP_OUTPUT_FILE")"
execution_profile="$(read_env_value ACP_COMPLETION_EXECUTION_PROFILE || true)"
worker_execution_adapter="$(read_env_value WORKER_EXECUTION_ADAPTER || true)"
worker_execution_adapter="${worker_execution_adapter:-${WORKER_EXECUTION_ADAPTER:-}}"
if [[ -z "$execution_profile" && "${ACP_COMPLETION_EXECUTION_PROFILE:-}" ]]; then
  execution_profile="$ACP_COMPLETION_EXECUTION_PROFILE"
elif [[ -z "$execution_profile" && "$worker_execution_adapter" == "openhands-cloud" ]]; then
  execution_profile="openhands-cloud"
fi
execution_profile="${execution_profile:-codex-cli}"

secret_env_exists="false"
secret_env_mode="missing"
if [[ -f "$SECRET_ENV_FILE" ]]; then
  secret_env_exists="true"
  secret_env_mode="$(stat -f '%Lp' "$SECRET_ENV_FILE" 2>/dev/null || stat -c '%a' "$SECRET_ENV_FILE" 2>/dev/null || printf 'unknown')"
fi

plane_base_url_status="$(env_value_status PLANE_BASE_URL)"
openhands_base_url_status="$(optional_env_value_status OPENHANDS_BASE_URL)"
langfuse_base_url_status="$(optional_env_value_status LANGFUSE_BASE_URL)"
smoke_base_url_status="$(env_value_status ACP_SMOKE_BASE_URL)"
operator_api_token_status="$(env_value_status ACP_OPERATOR_API_TOKEN)"
operator_login_password_status="$(env_value_status ACP_OPERATOR_LOGIN_PASSWORD)"
operator_session_secret_status="$(env_value_status ACP_OPERATOR_SESSION_SECRET)"
plane_workspace_slug_status="$(env_value_status PLANE_WORKSPACE_SLUG)"
plane_project_id_status="$(env_value_status PLANE_PROJECT_ID)"
plane_api_key_status="$(env_value_status PLANE_API_KEY)"
plane_webhook_secret_status="$(env_value_status PLANE_WEBHOOK_SECRET)"
plane_writeback_work_item_status="$(env_value_status PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID)"
secret_command_status="$(env_value_status ACP_SECRET_COMMAND)"
secret_provider_audit_command_status="$(env_value_status SECRET_PROVIDER_AUDIT_COMMAND)"
legacy_poller_evidence_status="$(env_value_status ACP_CUTOVER_LEGACY_POLLER_EVIDENCE)"
linear_archive_evidence_status="$(env_value_status ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE)"
legacy_poller_readonly_status="$(env_true_status ACP_CUTOVER_LEGACY_POLLER_READONLY)"
linear_archive_confirmed_status="$(env_true_status ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED)"

plane_probe_url="${ACP_COMPLETION_DOCTOR_PLANE_PROBE_URL:-}"
if [[ -z "$plane_probe_url" && "$plane_base_url_status" == "set" ]]; then
  plane_probe_url="$(read_env_value PLANE_BASE_URL)"
fi
plane_probe_url="${plane_probe_url:-http://127.0.0.1:3200}"

control_plane_probe_url="${ACP_COMPLETION_DOCTOR_CONTROL_PLANE_PROBE_URL:-}"
if [[ -z "$control_plane_probe_url" && "$smoke_base_url_status" == "set" ]]; then
  control_plane_probe_url="$(read_env_value ACP_SMOKE_BASE_URL)"
fi
control_plane_probe_url="${control_plane_probe_url:-http://127.0.0.1:3112/api/readiness}"

openhands_probe_url="${ACP_COMPLETION_DOCTOR_OPENHANDS_PROBE_URL:-}"
if [[ -z "$openhands_probe_url" && "$openhands_base_url_status" == "set" ]]; then
  openhands_probe_url="$(read_env_value OPENHANDS_BASE_URL)"
fi

langfuse_probe_url="${ACP_COMPLETION_DOCTOR_LANGFUSE_PROBE_URL:-}"
if [[ -z "$langfuse_probe_url" && "$langfuse_base_url_status" == "set" ]]; then
  langfuse_probe_url="$(read_env_value LANGFUSE_BASE_URL)"
fi

cat <<EOF
completion_doctor=reported
completion_doctor_id=${DOCTOR_ID}
gap_status=${gap_status:-unknown}
ready_count=${ready_count:-0}
missing_count=${missing_count:-0}
gap_scope_summary=${gap_scope_summary:-}
manual_missing_variables_count=${manual_missing_variables_count:-0}
manual_missing_required_variables=${manual_required_variables:-}
manual_placeholder_variables=${manual_placeholder_variables:-}
manual_not_true_variables=${manual_not_true_variables:-}
completion_final_auto_bound_missing_variables=${auto_bound_variables:-}
secret_env_file=${SECRET_ENV_FILE}
secret_env_file_exists=${secret_env_exists}
secret_env_file_mode=${secret_env_mode}
env_PLANE_BASE_URL=${plane_base_url_status}
env_OPENHANDS_BASE_URL=${openhands_base_url_status}
env_LANGFUSE_BASE_URL=${langfuse_base_url_status}
env_ACP_SMOKE_BASE_URL=${smoke_base_url_status}
env_ACP_OPERATOR_API_TOKEN=${operator_api_token_status}
env_ACP_OPERATOR_LOGIN_PASSWORD=${operator_login_password_status}
env_ACP_OPERATOR_SESSION_SECRET=${operator_session_secret_status}
env_PLANE_WORKSPACE_SLUG=${plane_workspace_slug_status}
env_PLANE_PROJECT_ID=${plane_project_id_status}
env_PLANE_API_KEY=${plane_api_key_status}
env_PLANE_WEBHOOK_SECRET=${plane_webhook_secret_status}
env_PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID=${plane_writeback_work_item_status}
env_ACP_SECRET_COMMAND=${secret_command_status}
env_SECRET_PROVIDER_AUDIT_COMMAND=${secret_provider_audit_command_status}
env_ACP_CUTOVER_LEGACY_POLLER_READONLY=${legacy_poller_readonly_status}
env_ACP_CUTOVER_LEGACY_POLLER_EVIDENCE=${legacy_poller_evidence_status}
env_ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED=${linear_archive_confirmed_status}
env_ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE=${linear_archive_evidence_status}
gap_report_file=${GAP_REPORT_FILE}
gap_variables_file=${GAP_VARIABLES_FILE}
gap_variable_matrix_file=${GAP_MATRIX_FILE}
gap_checklist_file=${GAP_CHECKLIST_FILE}
gap_action_plan_file=${GAP_ACTION_PLAN_FILE}
EOF

if [[ -n "$gap_scope_status_lines" ]]; then
  printf '%s\n' "$gap_scope_status_lines"
fi

plane_probe_result=""
plane_probe_http_status=""
control_plane_probe_result=""
control_plane_probe_http_status=""
openhands_probe_result=""
openhands_probe_http_status=""
langfuse_probe_result=""
langfuse_probe_http_status=""
probe_url_status_into plane_probe_result plane_probe_http_status "$plane_probe_url"
probe_url_status_into control_plane_probe_result control_plane_probe_http_status "$control_plane_probe_url"
probe_url_status_into openhands_probe_result openhands_probe_http_status "$openhands_probe_url"
probe_url_status_into langfuse_probe_result langfuse_probe_http_status "$langfuse_probe_url"

printf 'local_probe_plane=%s\n' "$plane_probe_result"
if [[ -n "$plane_probe_http_status" && "$plane_probe_http_status" != "000" ]]; then
  printf 'local_probe_plane_status=%s\n' "$plane_probe_http_status"
fi
printf 'local_probe_control_plane=%s\n' "$control_plane_probe_result"
if [[ -n "$control_plane_probe_http_status" && "$control_plane_probe_http_status" != "000" ]]; then
  printf 'local_probe_control_plane_status=%s\n' "$control_plane_probe_http_status"
fi
printf 'local_probe_openhands=%s\n' "$openhands_probe_result"
if [[ -n "$openhands_probe_http_status" && "$openhands_probe_http_status" != "000" ]]; then
  printf 'local_probe_openhands_status=%s\n' "$openhands_probe_http_status"
fi
printf 'local_probe_langfuse=%s\n' "$langfuse_probe_result"
if [[ -n "$langfuse_probe_http_status" && "$langfuse_probe_http_status" != "000" ]]; then
  printf 'local_probe_langfuse_status=%s\n' "$langfuse_probe_http_status"
fi

cat <<EOF
hint_fill_manual_variables=$(if [[ "${manual_missing_variables_count:-0}" != "0" ]]; then printf 'true'; else printf 'false'; fi)
hint_replace_placeholders=$(if [[ -n "${manual_placeholder_variables:-}" ]]; then printf 'true'; else printf 'false'; fi)
hint_confirm_cutover_booleans=$(if [[ "$legacy_poller_readonly_status" != "true" || "$linear_archive_confirmed_status" != "true" ]]; then printf 'true'; else printf 'false'; fi)
hint_start_control_plane=$(if [[ "$control_plane_probe_result" == "unreachable" ]]; then printf 'true'; else printf 'false'; fi)
hint_start_control_plane_command=$(if [[ "$control_plane_probe_result" == "unreachable" ]]; then printf 'pnpm dev'; else printf 'not-needed'; fi)
hint_do_not_use_loopback_for_final_cutover=true
next_command_generate_env_template=${next_command_generate_env_template:-ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=${SECRET_ENV_FILE} pnpm completion:final-env-template}
next_command_fill_env=${SECRET_ENV_FILE}
next_command_view_action_plan=sed -n '1,220p' ${GAP_ACTION_PLAN_FILE}
next_command_view_checklist=sed -n '1,220p' ${GAP_CHECKLIST_FILE}
next_command_view_variable_matrix=sed -n '1,220p' ${GAP_MATRIX_FILE}
next_command_show_missing=ACP_SECRET_ENV_FILE=${SECRET_ENV_FILE} ACP_COMPLETION_GAP_SHOW_MISSING=true pnpm completion:gap
next_command_gap=ACP_SECRET_ENV_FILE=${SECRET_ENV_FILE} pnpm completion:gap
next_command_preflight=ACP_SECRET_ENV_FILE=${SECRET_ENV_FILE} pnpm external:preflight
next_command_final=ACP_SECRET_ENV_FILE=${SECRET_ENV_FILE} pnpm completion:final
EOF
