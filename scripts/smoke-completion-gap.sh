#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-completion-gap-smoke.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

OUTPUT_FILE="$TMP_DIR/completion-gap.out"
EXPLICIT_ENV_OUTPUT_FILE="$TMP_DIR/completion-gap-explicit-env.out"
DEFAULT_ENV_OUTPUT_FILE="$TMP_DIR/completion-gap-default-env.out"
REPORT_FILE="$TMP_DIR/completion-gap.json"
EXPLICIT_ENV_REPORT_FILE="$TMP_DIR/completion-gap-explicit-env.json"
DEFAULT_ENV_REPORT_FILE="$TMP_DIR/completion-gap-default-env.json"
VARIABLES_FILE="$TMP_DIR/completion-gap.variables.txt"
EXPLICIT_ENV_VARIABLES_FILE="$TMP_DIR/completion-gap-explicit-env.variables.txt"
DEFAULT_ENV_VARIABLES_FILE="$TMP_DIR/completion-gap-default-env.variables.txt"
VARIABLE_MATRIX_FILE="$TMP_DIR/completion-gap.variables.tsv"
EXPLICIT_ENV_VARIABLE_MATRIX_FILE="$TMP_DIR/completion-gap-explicit-env.variables.tsv"
DEFAULT_ENV_VARIABLE_MATRIX_FILE="$TMP_DIR/completion-gap-default-env.variables.tsv"
CHECKLIST_FILE="$TMP_DIR/completion-gap.checklist.md"
EXPLICIT_ENV_CHECKLIST_FILE="$TMP_DIR/completion-gap-explicit-env.checklist.md"
DEFAULT_ENV_CHECKLIST_FILE="$TMP_DIR/completion-gap-default-env.checklist.md"
ACTION_PLAN_FILE="$TMP_DIR/completion-gap.action-plan.md"
EXPLICIT_ENV_ACTION_PLAN_FILE="$TMP_DIR/completion-gap-explicit-env.action-plan.md"
DEFAULT_ENV_ACTION_PLAN_FILE="$TMP_DIR/completion-gap-default-env.action-plan.md"
EXPLICIT_ENV_FILE="$TMP_DIR/completion-final.env"
DEFAULT_ENV_FILE="$TMP_DIR/default-completion-final.env"

cat >"$EXPLICIT_ENV_FILE" <<'EOF'
# Intentionally incomplete; completion:gap must still report missing real cutover values.
ACP_EXTERNAL_PREFLIGHT_ID="<external-preflight-id>"
ACP_CUTOVER_REPORT_ID="<cutover-report-id>"
EOF
chmod 600 "$EXPLICIT_ENV_FILE"

cat >"$DEFAULT_ENV_FILE" <<'EOF'
# Intentionally incomplete; completion:gap should auto-load this file for diagnostics only.
EOF
chmod 600 "$DEFAULT_ENV_FILE"

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_COMPLETION_GAP_USE_DEFAULT_ENV_FILE=false \
  ACP_COMPLETION_GAP_ID="completion-gap-smoke" \
  ACP_COMPLETION_GAP_REPORT_FILE="$REPORT_FILE" \
  ACP_COMPLETION_GAP_VARIABLES_FILE="$VARIABLES_FILE" \
  ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE="$VARIABLE_MATRIX_FILE" \
  ACP_COMPLETION_GAP_CHECKLIST_FILE="$CHECKLIST_FILE" \
  ACP_COMPLETION_GAP_ACTION_PLAN_FILE="$ACTION_PLAN_FILE" \
  bash scripts/completion-gap.sh >"$OUTPUT_FILE"

if ! grep -q "^completion_gap=reported$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not report" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^completion_gap_status=failed$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap should preserve failed preflight status for missing config" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^completion_gap_id=completion-gap-smoke$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not preserve id" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^completion_gap_report_file=${REPORT_FILE}$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print report file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^completion_gap_variables_file=${VARIABLES_FILE}$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print variables file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^completion_gap_variable_matrix_file=${VARIABLE_MATRIX_FILE}$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print variable matrix file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^completion_gap_checklist_file=${CHECKLIST_FILE}$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print checklist file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^completion_gap_action_plan_file=${ACTION_PLAN_FILE}$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print action plan file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^secret_env_file=not-set$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print secret env file status" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^default_final_env_file=.secrets/completion-final.env$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print default final env file path" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

default_exists="$(awk -F= '$1 == "default_final_env_file_exists" { print $2 }' "$OUTPUT_FILE")"
default_hint="$(awk -F= '$1 == "default_final_env_file_hint" { print $2 }' "$OUTPUT_FILE")"
if [[ "$default_exists" == "true" && "$default_hint" != "use_existing_default_with_ACP_SECRET_ENV_FILE" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap should hint to use existing default env file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if [[ "$default_exists" != "true" && "$default_hint" != "generate_default_final_env_file" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap should hint to generate default env file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$EXPLICIT_ENV_FILE" \
  ACP_COMPLETION_GAP_ID="completion-gap-explicit-env-smoke" \
  ACP_COMPLETION_GAP_REPORT_FILE="$EXPLICIT_ENV_REPORT_FILE" \
  ACP_COMPLETION_GAP_VARIABLES_FILE="$EXPLICIT_ENV_VARIABLES_FILE" \
  ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE="$EXPLICIT_ENV_VARIABLE_MATRIX_FILE" \
  ACP_COMPLETION_GAP_CHECKLIST_FILE="$EXPLICIT_ENV_CHECKLIST_FILE" \
  ACP_COMPLETION_GAP_ACTION_PLAN_FILE="$EXPLICIT_ENV_ACTION_PLAN_FILE" \
  bash scripts/completion-gap.sh >"$EXPLICIT_ENV_OUTPUT_FILE"

if ! grep -q "^default_final_env_file_hint=using_explicit_secret_env_file$" "$EXPLICIT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not report explicit secret env file hint" >&2
  cat "$EXPLICIT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm completion:gap$" "$EXPLICIT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not preserve explicit env file in gap command" >&2
  cat "$EXPLICIT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm external:preflight$" "$EXPLICIT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not preserve explicit env file in external preflight command" >&2
  cat "$EXPLICIT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_final=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm completion:final$" "$EXPLICIT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not preserve explicit env file in final command" >&2
  cat "$EXPLICIT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_generate_env_template=ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=${EXPLICIT_ENV_FILE} ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template$" "$EXPLICIT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print explicit env append-missing template command" >&2
  cat "$EXPLICIT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_COMPLETION_GAP_DEFAULT_ENV_FILE="$DEFAULT_ENV_FILE" \
  ACP_COMPLETION_GAP_ID="completion-gap-default-env-smoke" \
  ACP_COMPLETION_GAP_REPORT_FILE="$DEFAULT_ENV_REPORT_FILE" \
  ACP_COMPLETION_GAP_VARIABLES_FILE="$DEFAULT_ENV_VARIABLES_FILE" \
  ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE="$DEFAULT_ENV_VARIABLE_MATRIX_FILE" \
  ACP_COMPLETION_GAP_CHECKLIST_FILE="$DEFAULT_ENV_CHECKLIST_FILE" \
  ACP_COMPLETION_GAP_ACTION_PLAN_FILE="$DEFAULT_ENV_ACTION_PLAN_FILE" \
  bash scripts/completion-gap.sh >"$DEFAULT_ENV_OUTPUT_FILE"

if ! grep -q "^secret_env_file=${DEFAULT_ENV_FILE}$" "$DEFAULT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not auto-load default secret env file" >&2
  cat "$DEFAULT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^default_final_env_file=${DEFAULT_ENV_FILE}$" "$DEFAULT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print overridden default env file path" >&2
  cat "$DEFAULT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^default_final_env_file_hint=using_default_secret_env_file$" "$DEFAULT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not report default secret env file auto-load hint" >&2
  cat "$DEFAULT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=${DEFAULT_ENV_FILE} pnpm external:preflight$" "$DEFAULT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap default env run did not print default env external preflight command" >&2
  cat "$DEFAULT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_final=ACP_SECRET_ENV_FILE=${DEFAULT_ENV_FILE} pnpm completion:final$" "$DEFAULT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap default env run did not print default env final command" >&2
  cat "$DEFAULT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_generate_env_template=ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=${DEFAULT_ENV_FILE} ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template$" "$DEFAULT_ENV_OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap default env run did not print append-missing template command" >&2
  cat "$DEFAULT_ENV_OUTPUT_FILE" >&2
  exit 1
fi

missing_count="$(awk -F= '$1 == "missing_count" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${missing_count:-}" || "$missing_count" -le 0 ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap missing_count should be positive" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

placeholder_count="$(awk -F= '$1 == "missing_placeholders" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${placeholder_count:-}" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print placeholder count" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

required_count="$(awk -F= '$1 == "missing_required" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${required_count:-}" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print required-missing count" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

unsafe_url_count="$(awk -F= '$1 == "missing_unsafe_urls" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${unsafe_url_count:-}" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print unsafe URL count" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

not_true_count="$(awk -F= '$1 == "missing_not_true" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${not_true_count:-}" || "$not_true_count" -le 0 ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print positive not-true count" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

for mode_key in \
  completion_gap_report_mode \
  completion_gap_variables_mode \
  completion_gap_variable_matrix_mode \
  completion_gap_checklist_mode \
  completion_gap_action_plan_mode; do
  mode_value="$(awk -F= -v key="$mode_key" '$1 == key { print $2 }' "$OUTPUT_FILE")"
  if [[ "$mode_value" != "600" ]]; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=${mode_key} should be 600, got ${mode_value:-missing}" >&2
    cat "$OUTPUT_FILE" >&2
    exit 1
  fi
done

missing_variables="$(awk -F= '$1 == "missing_variables" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${missing_variables:-}" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print missing variables" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

missing_variables_count="$(awk -F= '$1 == "missing_variables_count" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${missing_variables_count:-}" || "$missing_variables_count" -le 0 ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print positive missing variables count" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

auto_bound_variables="$(awk -F= '$1 == "completion_final_auto_bound_missing_variables" { print $2 }' "$OUTPUT_FILE")"
expected_auto_bound_variables="ACP_COMPLETION_FINAL_RUN_ID,ACP_CUTOVER_REPORT_FILE,ACP_CUTOVER_REPORT_ID,ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE,ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT,ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE,ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE,ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE,ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE,ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE,ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE,ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE,PLANE_WRITEBACK_ENABLED,PLANE_WRITEBACK_SMOKE_APPLY,WORKER_EXECUTION_ADAPTER"
if [[ "$auto_bound_variables" != "$expected_auto_bound_variables" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not separate completion:final auto-bound variables" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

auto_bound_variables_count="$(awk -F= '$1 == "completion_final_auto_bound_missing_variables_count" { print $2 }' "$OUTPUT_FILE")"
if [[ "$auto_bound_variables_count" != "15" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print auto-bound variable count" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

manual_missing_variables="$(awk -F= '$1 == "manual_missing_variables" { print $2 }' "$OUTPUT_FILE")"
IFS=, read -r -a expected_auto_bound_variable_array <<<"$expected_auto_bound_variables"
for expected_auto_bound_variable in "${expected_auto_bound_variable_array[@]}"; do
  if [[ "$manual_missing_variables" == *"$expected_auto_bound_variable"* ]]; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=manual missing variables should not include completion:final auto-bound variables" >&2
    cat "$OUTPUT_FILE" >&2
    exit 1
  fi
done

manual_missing_variables_count="$(awk -F= '$1 == "manual_missing_variables_count" { print $2 }' "$OUTPUT_FILE")"
if [[ -z "${manual_missing_variables_count:-}" || "$manual_missing_variables_count" -le 0 ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print positive manual missing variables count" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

manual_required_variables="$(awk -F= '$1 == "manual_missing_required_variables" { print $2 }' "$OUTPUT_FILE")"
for expected_auto_bound_variable in "${expected_auto_bound_variable_array[@]}"; do
  if [[ "$manual_required_variables" == *"$expected_auto_bound_variable"* ]]; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=manual required variables should not include completion:final auto-bound variables" >&2
    cat "$OUTPUT_FILE" >&2
    exit 1
  fi
done

if [[ "$manual_required_variables" != *"ACP_OPERATOR_API_TOKEN"* ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=manual required variables should include operator API token" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

for reason_key in placeholder not_true unsafe_url other; do
  if ! grep -q "^manual_${reason_key}_variables_count=" "$OUTPUT_FILE"; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=completion gap did not print manual ${reason_key} variable count" >&2
    cat "$OUTPUT_FILE" >&2
    exit 1
  fi
  if ! grep -q "^manual_${reason_key}_variables=" "$OUTPUT_FILE"; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=completion gap did not print manual ${reason_key} variables" >&2
    cat "$OUTPUT_FILE" >&2
    exit 1
  fi
done

if ! grep -q "^missing_variables=.*ACP_CUTOVER_REPORT_FILE" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap missing variables do not include cutover report file" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

variables_mode="$(stat -f '%Lp' "$VARIABLES_FILE" 2>/dev/null || stat -c '%a' "$VARIABLES_FILE" 2>/dev/null || printf '')"
if [[ "$variables_mode" != "600" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=expected variables file mode 600, got ${variables_mode:-unknown}" >&2
  exit 1
fi

if ! grep -q "^ACP_CUTOVER_REPORT_FILE$" "$VARIABLES_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=variables file missing ACP_CUTOVER_REPORT_FILE" >&2
  cat "$VARIABLES_FILE" >&2
  exit 1
fi

matrix_mode="$(stat -f '%Lp' "$VARIABLE_MATRIX_FILE" 2>/dev/null || stat -c '%a' "$VARIABLE_MATRIX_FILE" 2>/dev/null || printf '')"
if [[ "$matrix_mode" != "600" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=expected variable matrix file mode 600, got ${matrix_mode:-unknown}" >&2
  exit 1
fi

if ! grep -q $'^variable\tscopes\treason_types\tmissing_count$' "$VARIABLE_MATRIX_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=variable matrix header missing" >&2
  cat "$VARIABLE_MATRIX_FILE" >&2
  exit 1
fi

if ! grep -q $'^ACP_CUTOVER_REPORT_FILE\tcutover_gate\tmissing_required\t1$' "$VARIABLE_MATRIX_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=variable matrix missing cutover report mapping" >&2
  cat "$VARIABLE_MATRIX_FILE" >&2
  exit 1
fi

for expected_not_true_variable in \
  ACP_CUTOVER_LEGACY_POLLER_READONLY \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED; do
  if ! grep -q "^${expected_not_true_variable}"$'\tcutover_gate\tnot_true\t1$' "$VARIABLE_MATRIX_FILE"; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=variable matrix missing not_true mapping for ${expected_not_true_variable}" >&2
    cat "$VARIABLE_MATRIX_FILE" >&2
    exit 1
  fi
done

checklist_mode="$(stat -f '%Lp' "$CHECKLIST_FILE" 2>/dev/null || stat -c '%a' "$CHECKLIST_FILE" 2>/dev/null || printf '')"
if [[ "$checklist_mode" != "600" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=expected checklist file mode 600, got ${checklist_mode:-unknown}" >&2
  exit 1
fi

action_plan_mode="$(stat -f '%Lp' "$ACTION_PLAN_FILE" 2>/dev/null || stat -c '%a' "$ACTION_PLAN_FILE" 2>/dev/null || printf '')"
if [[ "$action_plan_mode" != "600" ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=expected action plan file mode 600, got ${action_plan_mode:-unknown}" >&2
  exit 1
fi

if ! grep -q "^# Completion Gap Checklist$" "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist title missing" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q "^### cutover_gate$" "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing cutover gate section" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q "^## Auto-bound By completion:final$" "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing completion final auto-bound section" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q '^- `ACP_COMPLETION_FINAL_RUN_ID`$' "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing auto-bound final run id" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q '^- `ACP_CUTOVER_REPORT_FILE`$' "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing auto-bound cutover report file" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

for expected_auto_bound_variable in "${expected_auto_bound_variable_array[@]}"; do
  if ! grep -q "^- \`${expected_auto_bound_variable}\`$" "$CHECKLIST_FILE"; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=checklist missing auto-bound variable ${expected_auto_bound_variable}" >&2
    cat "$CHECKLIST_FILE" >&2
    exit 1
  fi
done

if ! grep -q "^## Manual Variables By Reason$" "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing manual variables by reason section" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q "^### missing_required$" "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing manual missing_required group" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q "^### not_true$" "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing manual not_true group" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q '^- `ACP_CUTOVER_LEGACY_POLLER_READONLY`$' "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing not_true legacy poller gate" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q '^- `ACP_OPERATOR_API_TOKEN`$' "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing manual required operator token" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

if ! grep -q '^- \[auto\] `ACP_CUTOVER_REPORT_FILE` (missing_required)' "$CHECKLIST_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=checklist missing auto-bound cutover report scope marker" >&2
  cat "$CHECKLIST_FILE" >&2
  exit 1
fi

for expected_auto_bound_variable in "${expected_auto_bound_variable_array[@]}"; do
  if grep -q "^- \\[ \\] \`${expected_auto_bound_variable}\`" "$CHECKLIST_FILE"; then
    echo "completion_gap_smoke=failed" >&2
    echo "error=auto-bound variable ${expected_auto_bound_variable} should not render as a manual checkbox" >&2
    cat "$CHECKLIST_FILE" >&2
    exit 1
  fi
done

if ! grep -q "^# Completion Cutover Action Plan$" "$ACTION_PLAN_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=action plan title missing" >&2
  cat "$ACTION_PLAN_FILE" >&2
  exit 1
fi

if ! grep -q "^## Operator Sequence$" "$ACTION_PLAN_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=action plan missing operator sequence" >&2
  cat "$ACTION_PLAN_FILE" >&2
  exit 1
fi

if ! grep -q "^## Manual Variables$" "$ACTION_PLAN_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=action plan missing manual variables" >&2
  cat "$ACTION_PLAN_FILE" >&2
  exit 1
fi

if ! grep -q "^### not_true$" "$ACTION_PLAN_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=action plan missing not_true group" >&2
  cat "$ACTION_PLAN_FILE" >&2
  exit 1
fi

if ! grep -q 'Set each variable in this group to `true` only after the corresponding cutover evidence exists.' "$ACTION_PLAN_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=action plan missing not_true operator guidance" >&2
  cat "$ACTION_PLAN_FILE" >&2
  exit 1
fi

if ! grep -q '^- `ACP_OPERATOR_API_TOKEN`: scopes=`cutover_gate`; missing_count=1$' "$ACTION_PLAN_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=action plan missing operator token action" >&2
  cat "$ACTION_PLAN_FILE" >&2
  exit 1
fi

if ! grep -q '^- `cutover_gate`: status=`missing`; missing=' "$ACTION_PLAN_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=action plan missing scope ordering" >&2
  cat "$ACTION_PLAN_FILE" >&2
  exit 1
fi

expected_default_template_command="ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=.secrets/completion-final.env pnpm completion:final-env-template"
if [[ -f .secrets/completion-final.env ]]; then
  expected_default_template_command="ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=.secrets/completion-final.env ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template"
fi
if ! grep -q "^next_command_generate_env_template=${expected_default_template_command}$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print env template command" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:gap$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print gap-with-env command" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm external:preflight$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print external preflight command" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q "^next_command_run_final=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:final$" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print final command" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q 'ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=".secrets/completion-final.env"' docs/agent-control-plane-production-runbook.md; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=production runbook does not document completion-final env template path" >&2
  exit 1
fi

if ! grep -q 'ACP_SECRET_ENV_FILE=".secrets/completion-final.env"' docs/agent-control-plane-production-runbook.md; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=production runbook does not document completion-final secret env path" >&2
  exit 1
fi

if ! grep -q "^scope=cutover_gate;status=missing;ready=0;missing=" "$OUTPUT_FILE"; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print cutover_gate scope summary" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

scope_count="$(grep -c '^scope=' "$OUTPUT_FILE" || true)"
if [[ "$scope_count" -le 0 ]]; then
  echo "completion_gap_smoke=failed" >&2
  echo "error=completion gap did not print any scope summary" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

EXPECTED_DEFAULT_TEMPLATE_COMMAND="$expected_default_template_command" \
  node - "$REPORT_FILE" "$VARIABLES_FILE" "$VARIABLE_MATRIX_FILE" "$CHECKLIST_FILE" "$ACTION_PLAN_FILE" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const variablesFile = process.argv[3];
const variableMatrixFile = process.argv[4];
const checklistFile = process.argv[5];
const actionPlanFile = process.argv[6];
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const expectedAutoBoundVariables = [
  "ACP_COMPLETION_FINAL_RUN_ID",
  "ACP_CUTOVER_REPORT_FILE",
  "ACP_CUTOVER_REPORT_ID",
  "ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE",
  "ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT",
  "ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE",
  "ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE",
  "ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE",
  "ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE",
  "ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE",
  "ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE",
  "ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE",
  "PLANE_WRITEBACK_ENABLED",
  "PLANE_WRITEBACK_SMOKE_APPLY",
  "WORKER_EXECUTION_ADAPTER",
];
const mode = (fs.statSync(reportFile).mode & 0o777).toString(8);
if (mode !== "600") throw new Error(`expected report mode 600, got ${mode}`);
if (report.preflightId !== "completion-gap-smoke") throw new Error("bad gap id");
if (report.status !== "failed") throw new Error("gap report must preserve failed status");
if (!Array.isArray(report.missing) || report.missing.length <= 0) {
  throw new Error("gap report missing list absent");
}
if (
  !Array.isArray(report.nextCommands) ||
  !report.nextCommands.includes(process.env.EXPECTED_DEFAULT_TEMPLATE_COMMAND) ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm external:preflight") ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:gap") ||
  !report.nextCommands.includes("pnpm smoke:production") ||
  !report.nextCommands.includes("pnpm plane:writeback-smoke") ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:final")
) {
  throw new Error("gap report next command absent");
}
if (!Array.isArray(report.scopeSummary) || report.scopeSummary.length <= 0) {
  throw new Error("gap report scope summary absent");
}
if (
  !report.generatedArtifacts ||
  report.generatedArtifacts.variablesFile !== variablesFile ||
  report.generatedArtifacts.variableMatrixFile !== variableMatrixFile ||
  report.generatedArtifacts.checklistFile !== checklistFile ||
  report.generatedArtifacts.actionPlanFile !== actionPlanFile
) {
  throw new Error("gap report generated artifacts absent");
}
if (report.generatedArtifacts.missingVariablesCount <= 0) {
  throw new Error("gap report generated artifacts missing variable count absent");
}
if (!Array.isArray(report.generatedArtifacts.missingVariables) || !report.generatedArtifacts.missingVariables.includes("ACP_CUTOVER_REPORT_FILE")) {
  throw new Error("gap report generated artifacts missing variable list absent");
}
if (report.generatedArtifacts.completionFinalAutoBoundMissingVariablesCount !== expectedAutoBoundVariables.length) {
  throw new Error("gap report generated artifacts auto-bound count absent");
}
if (
  !Array.isArray(report.generatedArtifacts.completionFinalAutoBoundMissingVariables) ||
  expectedAutoBoundVariables.some(
    (variableName) => !report.generatedArtifacts.completionFinalAutoBoundMissingVariables.includes(variableName),
  )
) {
  throw new Error("gap report generated artifacts auto-bound variables absent");
}
if (
  !Array.isArray(report.generatedArtifacts.manualMissingVariables) ||
  expectedAutoBoundVariables.some((variableName) => report.generatedArtifacts.manualMissingVariables.includes(variableName))
) {
  throw new Error("gap report generated artifacts manual variables should exclude auto-bound variables");
}
if (report.generatedArtifacts.manualMissingVariablesCount !== report.generatedArtifacts.manualMissingVariables.length) {
  throw new Error("gap report generated artifacts manual variable count mismatch");
}
if (
  !report.generatedArtifacts.manualVariablesByReason ||
  !Array.isArray(report.generatedArtifacts.manualVariablesByReason.missing_required) ||
  !report.generatedArtifacts.manualVariablesByReason.missing_required.includes("ACP_OPERATOR_API_TOKEN")
) {
  throw new Error("gap report generated artifacts manual variables by reason absent");
}
if (
  !Array.isArray(report.generatedArtifacts.manualVariablesByReason.not_true) ||
  !report.generatedArtifacts.manualVariablesByReason.not_true.includes("ACP_CUTOVER_LEGACY_POLLER_READONLY") ||
  !report.generatedArtifacts.manualVariablesByReason.not_true.includes("ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED")
) {
  throw new Error("gap report generated artifacts not_true variables absent");
}
NODE

node - "$EXPLICIT_ENV_REPORT_FILE" "$EXPLICIT_ENV_FILE" "$EXPLICIT_ENV_ACTION_PLAN_FILE" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const explicitEnvFile = process.argv[3];
const actionPlanFile = process.argv[4];
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
if (
  !Array.isArray(report.nextCommands) ||
  !report.nextCommands.includes(`ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=${explicitEnvFile} ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template`) ||
  !report.nextCommands.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm external:preflight`) ||
  !report.nextCommands.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm completion:gap`) ||
  !report.nextCommands.includes("pnpm smoke:production") ||
  !report.nextCommands.includes("pnpm plane:writeback-smoke") ||
  !report.nextCommands.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm completion:final`)
) {
  throw new Error("explicit env report next commands absent");
}
const actionPlan = fs.readFileSync(actionPlanFile, "utf8");
if (!actionPlan.includes(`ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=${explicitEnvFile} ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template`)) {
  throw new Error("explicit env action plan append-missing template command absent");
}
if (!actionPlan.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm external:preflight`)) {
  throw new Error("explicit env action plan external preflight command absent");
}
if (!actionPlan.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm completion:gap`)) {
  throw new Error("explicit env action plan gap command absent");
}
if (!actionPlan.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm completion:final`)) {
  throw new Error("explicit env action plan final command absent");
}
if (
  !Array.isArray(report.generatedArtifacts?.completionFinalAutoBoundMissingVariables) ||
  !report.generatedArtifacts.completionFinalAutoBoundMissingVariables.includes("ACP_EXTERNAL_PREFLIGHT_ID") ||
  !report.generatedArtifacts.completionFinalAutoBoundMissingVariables.includes("ACP_CUTOVER_REPORT_ID")
) {
  throw new Error("explicit env report should classify final/preflight/report ids as auto-bound");
}
if (
  !Array.isArray(report.generatedArtifacts?.manualMissingVariables) ||
  report.generatedArtifacts.manualMissingVariables.includes("ACP_EXTERNAL_PREFLIGHT_ID") ||
  report.generatedArtifacts.manualMissingVariables.includes("ACP_CUTOVER_REPORT_ID")
) {
  throw new Error("explicit env report manual variables should exclude final/preflight/report ids");
}
const explicitMatrix = fs.readFileSync(report.generatedArtifacts.variableMatrixFile, "utf8");
if (
  !explicitMatrix.includes("ACP_EXTERNAL_PREFLIGHT_ID\tcutover_gate\tplaceholder\t1") ||
  !explicitMatrix.includes("ACP_CUTOVER_REPORT_ID\tcutover_gate\tplaceholder\t1")
) {
  throw new Error("explicit env variable matrix should include placeholder final binding ids");
}
NODE

echo "completion_gap_smoke=passed"
