#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-completion-doctor-smoke.XXXXXX")"
cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ENV_FILE="$TMP_DIR/completion-final.env"
OUTPUT_FILE="$TMP_DIR/completion-doctor.out"
LEGACY_ENV_FILE="$TMP_DIR/completion-final-legacy.env"
LEGACY_OUTPUT_FILE="$TMP_DIR/completion-doctor-legacy.out"
REPORT_FILE="$TMP_DIR/completion-doctor.gap.json"
VARIABLES_FILE="$TMP_DIR/completion-doctor.variables.txt"
MATRIX_FILE="$TMP_DIR/completion-doctor.variables.tsv"
CHECKLIST_FILE="$TMP_DIR/completion-doctor.checklist.md"
ACTION_PLAN_FILE="$TMP_DIR/completion-doctor.action-plan.md"
LEGACY_REPORT_FILE="$TMP_DIR/completion-doctor-legacy.gap.json"
LEGACY_VARIABLES_FILE="$TMP_DIR/completion-doctor-legacy.variables.txt"
LEGACY_MATRIX_FILE="$TMP_DIR/completion-doctor-legacy.variables.tsv"
LEGACY_CHECKLIST_FILE="$TMP_DIR/completion-doctor-legacy.checklist.md"
LEGACY_ACTION_PLAN_FILE="$TMP_DIR/completion-doctor-legacy.action-plan.md"
PORT_FILE="$TMP_DIR/server.port"

cat >"$ENV_FILE" <<'EOF'
PLANE_BASE_URL="https://plane.example.com"
PLANE_WORKSPACE_SLUG="<plane-workspace-slug>"
PLANE_PROJECT_ID="<plane-project-id>"
PLANE_API_KEY="<plane-api-key>"
PLANE_WEBHOOK_SECRET="<plane-webhook-secret>"
PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="<plane-work-item-id>"
ACP_OPERATOR_API_TOKEN="<operator-token>"
ACP_OPERATOR_LOGIN_PASSWORD="<operator-login-password>"
ACP_OPERATOR_SESSION_SECRET="<operator-session-secret>"
ACP_SECRET_COMMAND="<secret-provider-command>"
SECRET_PROVIDER_AUDIT_COMMAND="<secret-provider-audit-command>"
ACP_CUTOVER_LEGACY_POLLER_READONLY=false
ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="<legacy-poller-evidence>"
ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED=false
ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="<linear-archive-evidence>"
OPENHANDS_BASE_URL="https://openhands.example.com"
LANGFUSE_BASE_URL=""
ACP_SMOKE_BASE_URL="<control-plane-url>"
OPENHANDS_SMOKE_PAYLOAD_FILE=""
EOF
chmod 600 "$ENV_FILE"
cp "$ENV_FILE" "$LEGACY_ENV_FILE"
printf 'ACP_COMPLETION_EXECUTION_PROFILE="openhands-langfuse"\n' >>"$LEGACY_ENV_FILE"
chmod 600 "$LEGACY_ENV_FILE"

node - "$PORT_FILE" <<'NODE' &
const fs = require("node:fs");
const http = require("node:http");
const portFile = process.argv[2];
const server = http.createServer((_, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port));
});
NODE
SERVER_PID="$!"

for _ in $(seq 1 50); do
  [[ -s "$PORT_FILE" ]] && break
  sleep 0.1
done
if [[ ! -s "$PORT_FILE" ]]; then
  echo "completion_doctor_smoke=failed" >&2
  echo "error=fake probe server did not start" >&2
  exit 1
fi
FAKE_PORT="$(cat "$PORT_FILE")"

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$ENV_FILE" \
  ACP_COMPLETION_DOCTOR_ID="completion-doctor-smoke" \
  ACP_COMPLETION_DOCTOR_GAP_REPORT_FILE="$REPORT_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_VARIABLES_FILE="$VARIABLES_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_VARIABLE_MATRIX_FILE="$MATRIX_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_CHECKLIST_FILE="$CHECKLIST_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_ACTION_PLAN_FILE="$ACTION_PLAN_FILE" \
  ACP_COMPLETION_DOCTOR_PLANE_PROBE_URL="http://127.0.0.1:${FAKE_PORT}/plane" \
  ACP_COMPLETION_DOCTOR_CONTROL_PLANE_PROBE_URL="http://127.0.0.1:${FAKE_PORT}/readiness" \
  ACP_COMPLETION_DOCTOR_OPENHANDS_PROBE_URL="" \
  ACP_COMPLETION_DOCTOR_LANGFUSE_PROBE_URL="" \
  ACP_COMPLETION_DOCTOR_PROBE_TIMEOUT_SECONDS="1" \
  bash scripts/completion-doctor.sh >"$OUTPUT_FILE"

require_line() {
  local pattern="$1"
  local message="$2"
  if ! grep -q "$pattern" "$OUTPUT_FILE"; then
    echo "completion_doctor_smoke=failed" >&2
    echo "error=${message}" >&2
    cat "$OUTPUT_FILE" >&2
    exit 1
  fi
}

require_line '^completion_doctor=reported$' "doctor did not report"
require_line '^completion_doctor_id=completion-doctor-smoke$' "doctor id missing"
require_line '^gap_status=failed$' "gap status should remain failed for incomplete env"
require_line '^gap_scope_summary=.*codex_adapter:' "doctor scope summary should include codex adapter scope"
require_line '^gap_scope_summary=.*cutover_gate:missing:' "doctor scope summary should include missing cutover gate scope"
require_line '^gap_scope_summary=.*task_source:missing:' "doctor scope summary should include missing task source scope"
require_line '^gap_scope_codex_adapter_status=' "doctor codex adapter scope status missing"
require_line '^gap_scope_cutover_gate_status=missing$' "doctor cutover gate scope status missing"
require_line '^gap_scope_cutover_gate_missing=' "doctor cutover gate missing count missing"
require_line '^gap_scope_task_source_status=missing$' "doctor task source scope status missing"
require_line '^gap_scope_task_source_missing=' "doctor task source missing count missing"
require_line '^secret_env_file_exists=true$' "secret env existence missing"
require_line '^secret_env_file_mode=600$' "secret env mode missing"
require_line '^env_PLANE_BASE_URL=placeholder$' "Plane placeholder status missing"
require_line '^env_PLANE_WORKSPACE_SLUG=placeholder$' "Plane workspace placeholder status missing"
require_line '^env_PLANE_PROJECT_ID=placeholder$' "Plane project placeholder status missing"
require_line '^env_PLANE_API_KEY=placeholder$' "Plane API key placeholder status missing"
require_line '^env_PLANE_WEBHOOK_SECRET=placeholder$' "Plane webhook placeholder status missing"
require_line '^env_PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID=placeholder$' "Plane writeback work item placeholder status missing"
require_line '^env_ACP_OPERATOR_API_TOKEN=placeholder$' "operator token placeholder status missing"
require_line '^env_ACP_OPERATOR_LOGIN_PASSWORD=placeholder$' "operator login password placeholder status missing"
require_line '^env_ACP_OPERATOR_SESSION_SECRET=placeholder$' "operator session secret placeholder status missing"
require_line '^env_ACP_SECRET_COMMAND=placeholder$' "secret command placeholder status missing"
require_line '^env_SECRET_PROVIDER_AUDIT_COMMAND=placeholder$' "secret provider audit command placeholder status missing"
require_line '^env_ACP_CUTOVER_LEGACY_POLLER_READONLY=false$' "legacy poller readonly confirmation status missing"
require_line '^env_ACP_CUTOVER_LEGACY_POLLER_EVIDENCE=placeholder$' "legacy poller evidence placeholder status missing"
require_line '^env_ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED=false$' "Linear archive confirmation status missing"
require_line '^env_ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE=placeholder$' "Linear archive evidence placeholder status missing"
require_line '^env_OPENHANDS_BASE_URL=optional_placeholder$' "OpenHands optional placeholder status missing"
require_line '^env_LANGFUSE_BASE_URL=optional_missing$' "Langfuse optional missing status missing"
require_line '^local_probe_plane=reachable$' "Plane probe should be reachable"
require_line '^local_probe_control_plane=reachable$' "Control Plane probe should be reachable"
require_line '^local_probe_openhands=skipped$' "OpenHands probe should be skipped"
require_line '^local_probe_langfuse=skipped$' "Langfuse probe should be skipped"
require_line '^hint_fill_manual_variables=true$' "manual variable hint missing"
require_line '^hint_replace_placeholders=true$' "placeholder hint missing"
require_line '^hint_confirm_cutover_booleans=true$' "cutover boolean confirmation hint missing"
require_line '^hint_start_control_plane=false$' "control plane hint should be false for reachable probe"
require_line '^hint_start_control_plane_command=not-needed$' "control plane command should be not-needed for reachable probe"
require_line '^hint_do_not_use_loopback_for_final_cutover=true$' "loopback cutover warning missing"
require_line "^gap_report_file=${REPORT_FILE}$" "gap report path missing"
require_line "^gap_variable_matrix_file=${MATRIX_FILE}$" "gap variable matrix path missing"
require_line "^gap_action_plan_file=${ACTION_PLAN_FILE}$" "gap action plan path missing"
require_line "^next_command_generate_env_template=ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=${ENV_FILE} ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template$" "env template append-missing next command missing"
require_line "^next_command_view_action_plan=sed -n '1,220p' ${ACTION_PLAN_FILE}$" "view action plan command missing"
require_line "^next_command_view_checklist=sed -n '1,220p' ${CHECKLIST_FILE}$" "view checklist command missing"
require_line "^next_command_view_variable_matrix=sed -n '1,220p' ${MATRIX_FILE}$" "view variable matrix command missing"
require_line "^next_command_show_missing=ACP_SECRET_ENV_FILE=${ENV_FILE} ACP_COMPLETION_GAP_SHOW_MISSING=true pnpm completion:gap$" "show missing command missing"
require_line "^next_command_gap=ACP_SECRET_ENV_FILE=${ENV_FILE} pnpm completion:gap$" "gap next command missing"
require_line '^manual_missing_variables_count=' "manual missing count missing"
require_line '^manual_placeholder_variables=' "manual placeholder variables missing"
require_line '^manual_not_true_variables=.*ACP_CUTOVER_LEGACY_POLLER_READONLY' "manual not_true legacy poller gate missing"
require_line '^manual_not_true_variables=.*ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED' "manual not_true Linear archive gate missing"

if [[ "$(stat -f '%Lp' "$REPORT_FILE" 2>/dev/null || stat -c '%a' "$REPORT_FILE")" != "600" ]]; then
  echo "completion_doctor_smoke=failed" >&2
  echo "error=gap report mode should be 600" >&2
  exit 1
fi

if grep -q '<plane-api-key>\|secret-value\|sk-' "$OUTPUT_FILE"; then
  echo "completion_doctor_smoke=failed" >&2
  echo "error=doctor output leaked secret-like values" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$LEGACY_ENV_FILE" \
  ACP_COMPLETION_DOCTOR_ID="completion-doctor-legacy-smoke" \
  ACP_COMPLETION_DOCTOR_GAP_REPORT_FILE="$LEGACY_REPORT_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_VARIABLES_FILE="$LEGACY_VARIABLES_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_VARIABLE_MATRIX_FILE="$LEGACY_MATRIX_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_CHECKLIST_FILE="$LEGACY_CHECKLIST_FILE" \
  ACP_COMPLETION_DOCTOR_GAP_ACTION_PLAN_FILE="$LEGACY_ACTION_PLAN_FILE" \
  ACP_COMPLETION_DOCTOR_PLANE_PROBE_URL="http://127.0.0.1:${FAKE_PORT}/plane" \
  ACP_COMPLETION_DOCTOR_CONTROL_PLANE_PROBE_URL="http://127.0.0.1:${FAKE_PORT}/readiness" \
  ACP_COMPLETION_DOCTOR_OPENHANDS_PROBE_URL="" \
  ACP_COMPLETION_DOCTOR_LANGFUSE_PROBE_URL="" \
  ACP_COMPLETION_DOCTOR_PROBE_TIMEOUT_SECONDS="1" \
  bash scripts/completion-doctor.sh >"$LEGACY_OUTPUT_FILE"

OUTPUT_FILE="$LEGACY_OUTPUT_FILE"
require_line '^completion_doctor_id=completion-doctor-legacy-smoke$' "legacy doctor id missing"
require_line '^gap_scope_summary=.*openhands_conversation:missing:' "legacy scope summary should include OpenHands conversation scope"
require_line '^gap_scope_summary=.*langfuse_trace:missing:' "legacy scope summary should include Langfuse trace scope"
require_line '^env_OPENHANDS_BASE_URL=placeholder$' "OpenHands should be required for legacy profile"
require_line '^env_LANGFUSE_BASE_URL=missing$' "Langfuse should be required for legacy profile"

echo "completion_doctor_smoke=passed"
