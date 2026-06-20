#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-completion-final.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

OUTPUT_FILE="$TMP_DIR/completion-final.out"
DEFAULT_REPORT_OUTPUT="$TMP_DIR/default-report.out"
EXPLICIT_ENV_OUTPUT="$TMP_DIR/explicit-env.out"
EXPLICIT_ENV_FILE="$TMP_DIR/completion-final.env"
DEFAULT_TEMPLATE_COMMAND="ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=.secrets/completion-final.env pnpm completion:final-env-template"
if [[ -f .secrets/completion-final.env ]]; then
  DEFAULT_TEMPLATE_COMMAND="ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=.secrets/completion-final.env ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template"
fi

cat >"$EXPLICIT_ENV_FILE" <<'EOF'
# Intentionally empty; dry-run only needs to prove explicit env file routing.
EOF
chmod 600 "$EXPLICIT_ENV_FILE"

ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
  bash scripts/completion-final.sh >"$OUTPUT_FILE"

if ! grep -q "completion_final_dry_run=passed" "$OUTPUT_FILE"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=dry run did not pass" >&2
  exit 1
fi

if ! grep -Eq "^completion_final_run_id=.+$" "$OUTPUT_FILE"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=dry run did not print completion final run id" >&2
  exit 1
fi

if ! grep -Eq "^external_preflight_id=external-preflight-.+$" "$OUTPUT_FILE"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=dry run did not print default external preflight id" >&2
  exit 1
fi

for expected in \
  "completion_execution_profile=codex-cli" \
  "production_smoke=true" \
  "plane_writeback_smoke=true" \
  "codex_adapter_smoke=true" \
  "openhands_smoke=false" \
  "openhands_adapter_smoke=false" \
  "openhands_db_smoke=false" \
  "langfuse_smoke=false" \
  "task_source_smoke=true" \
  "worker_crash_smoke=true" \
  "worker_budget_smoke=true" \
  "worker_workflow_smoke=true" \
  "secret_provider_smoke=true" \
  "secret_provider_audit_smoke=true" \
  "external_preflight_smoke=true" \
  "cutover_report_id=cutover-report-" \
  "smoke_external=false" \
  "smoke_user_write=false" \
  "plane_writeback_enabled=true" \
  "plane_writeback_apply=true" \
  "openhands_create_conversation=false" \
  "openhands_wait_ready=false" \
  "openhands_db_expect_trace_ref=false" \
  "langfuse_enabled=false" \
  "langfuse_dry_run=true" \
  "worker_crash_temp_db=true" \
  "worker_budget_temp_db=true" \
  "worker_workflow_temp_db=true" \
  "worker_execution_adapter=codex-cli" \
  "secret_env_file=not-set" \
  "default_final_env_file=.secrets/completion-final.env" \
  "next_command_generate_env_template=${DEFAULT_TEMPLATE_COMMAND}" \
  "next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm external:preflight" \
  "next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:gap" \
  "next_command_run_final=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:final"; do
  if ! grep -q "$expected" "$OUTPUT_FILE"; then
    echo "completion_final_smoke=failed" >&2
    echo "error=missing dry-run output ${expected}" >&2
    exit 1
  fi
done

default_exists="$(awk -F= '$1 == "default_final_env_file_exists" { print $2 }' "$OUTPUT_FILE")"
default_hint="$(awk -F= '$1 == "default_final_env_file_hint" { print $2 }' "$OUTPUT_FILE")"
if [[ "$default_exists" == "true" && "$default_hint" != "use_existing_default_with_ACP_SECRET_ENV_FILE" ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final should hint to use existing default env file" >&2
  exit 1
fi

if [[ "$default_exists" != "true" && "$default_hint" != "generate_default_final_env_file" ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final should hint to generate default env file" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/app-server-cutover-report.json" \
WORKER_EXECUTION_ADAPTER="codex-app-server" \
  bash scripts/completion-final.sh >"$TMP_DIR/app-server-dry-run.out"

if ! grep -q "^worker_execution_adapter=codex-app-server$" "$TMP_DIR/app-server-dry-run.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=codex-app-server worker adapter did not pass codex profile final dry run" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/explicit-env-cutover-report.json" \
ACP_SECRET_ENV_FILE="$EXPLICIT_ENV_FILE" \
  bash scripts/completion-final.sh >"$EXPLICIT_ENV_OUTPUT"

if ! grep -q "^secret_env_file=${EXPLICIT_ENV_FILE}$" "$EXPLICIT_ENV_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final did not print explicit secret env file path" >&2
  exit 1
fi

if ! grep -q "^default_final_env_file_hint=using_explicit_secret_env_file$" "$EXPLICIT_ENV_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final did not report explicit secret env file hint" >&2
  exit 1
fi

if ! grep -q "^next_command_generate_env_template=ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=${EXPLICIT_ENV_FILE} ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template$" "$EXPLICIT_ENV_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final dry run did not print explicit env append-missing template command" >&2
  exit 1
fi

if ! grep -q "^next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm completion:gap$" "$EXPLICIT_ENV_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final dry run did not print explicit env gap command" >&2
  exit 1
fi

if ! grep -q "^next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm external:preflight$" "$EXPLICIT_ENV_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final dry run did not print explicit env external preflight command" >&2
  exit 1
fi

if ! grep -q "^next_command_run_final=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm completion:final$" "$EXPLICIT_ENV_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=completion final dry run did not print explicit env final command" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_FINAL_RUN_ID="final-smoke-run" \
  bash scripts/completion-final.sh >"$DEFAULT_REPORT_OUTPUT"

if ! grep -q "completion_final_run_id=final-smoke-run" "$DEFAULT_REPORT_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=default report dry run did not preserve provided final run id" >&2
  exit 1
fi

if ! grep -q "cutover_report_file=reports/cutover-final-smoke-run.json" "$DEFAULT_REPORT_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=default report path is not bound to final run id" >&2
  exit 1
fi

if ! grep -q "external_preflight_id=external-preflight-final-smoke-run" "$DEFAULT_REPORT_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=default external preflight id is not bound to final run id" >&2
  exit 1
fi

if ! grep -q "cutover_report_id=cutover-report-final-smoke-run" "$DEFAULT_REPORT_OUTPUT"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=default cutover report id is not bound to final run id" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_FINAL_RUN_ID="final-smoke-run" \
ACP_EXTERNAL_PREFLIGHT_ID="explicit-preflight-smoke" \
  bash scripts/completion-final.sh >"$TMP_DIR/explicit-preflight-id.out"

if ! grep -q "external_preflight_id=explicit-preflight-smoke" "$TMP_DIR/explicit-preflight-id.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=explicit external preflight id was not preserved" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_FINAL_RUN_ID="final-smoke-run" \
ACP_CUTOVER_REPORT_ID="explicit-cutover-report-smoke" \
  bash scripts/completion-final.sh >"$TMP_DIR/explicit-cutover-report-id.out"

if ! grep -q "cutover_report_id=explicit-cutover-report-smoke" "$TMP_DIR/explicit-cutover-report-id.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=explicit cutover report id was not preserved" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
WORKER_CRASH_SMOKE_TEMP_DB=false \
  bash scripts/completion-final.sh >"$TMP_DIR/worker-crash-temp-db.out" 2>&1
WORKER_CRASH_TEMP_DB_STATUS=$?
set -e

if [[ "$WORKER_CRASH_TEMP_DB_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=worker crash temp DB dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "WORKER_CRASH_SMOKE_TEMP_DB must not be false" "$TMP_DIR/worker-crash-temp-db.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=worker crash temp DB dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
WORKER_BUDGET_SMOKE_TEMP_DB=false \
  bash scripts/completion-final.sh >"$TMP_DIR/worker-budget-temp-db.out" 2>&1
WORKER_BUDGET_TEMP_DB_STATUS=$?
set -e

if [[ "$WORKER_BUDGET_TEMP_DB_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=worker budget temp DB dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "WORKER_BUDGET_SMOKE_TEMP_DB must not be false" "$TMP_DIR/worker-budget-temp-db.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=worker budget temp DB dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
WORKER_WORKFLOW_SMOKE_TEMP_DB=false \
  bash scripts/completion-final.sh >"$TMP_DIR/worker-workflow-temp-db.out" 2>&1
WORKER_WORKFLOW_TEMP_DB_STATUS=$?
set -e

if [[ "$WORKER_WORKFLOW_TEMP_DB_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=worker workflow temp DB dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "WORKER_WORKFLOW_SMOKE_TEMP_DB must not be false" "$TMP_DIR/worker-workflow-temp-db.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=worker workflow temp DB dry run did not report final gate violation" >&2
  exit 1
fi

LEGACY_PROFILE_OUTPUT="$TMP_DIR/legacy-profile.out"
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_EXECUTION_PROFILE=openhands-langfuse \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/legacy-cutover-report.json" \
  bash scripts/completion-final.sh >"$LEGACY_PROFILE_OUTPUT"

for expected in \
  "completion_execution_profile=openhands-langfuse" \
  "production_smoke=true" \
  "plane_writeback_smoke=true" \
  "codex_adapter_smoke=false" \
  "openhands_smoke=true" \
  "openhands_adapter_smoke=true" \
  "openhands_db_smoke=true" \
  "langfuse_smoke=true" \
  "smoke_external=true" \
  "openhands_create_conversation=true" \
  "openhands_wait_ready=true" \
  "openhands_db_expect_trace_ref=true" \
  "langfuse_enabled=true" \
  "langfuse_dry_run=false" \
  "worker_execution_adapter=openhands-cloud"; do
  if ! grep -q "$expected" "$LEGACY_PROFILE_OUTPUT"; then
    echo "completion_final_smoke=failed" >&2
    echo "error=missing legacy profile dry-run output ${expected}" >&2
    exit 1
  fi
done

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE=false \
  bash scripts/completion-final.sh >"$TMP_DIR/bad-flag.out" 2>&1
BAD_FLAG_STATUS=$?
set -e

if [[ "$BAD_FLAG_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=bad flag dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE must be true" "$TMP_DIR/bad-flag.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=bad flag dry run did not report the disabled smoke" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE=false \
  bash scripts/completion-final.sh >"$TMP_DIR/bad-secret-provider-flag.out" 2>&1
BAD_SECRET_PROVIDER_FLAG_STATUS=$?
set -e

if [[ "$BAD_SECRET_PROVIDER_FLAG_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=bad secret provider flag dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE must be true" "$TMP_DIR/bad-secret-provider-flag.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=bad secret provider flag dry run did not report the disabled smoke" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
PLANE_WRITEBACK_SMOKE_APPLY=false \
  bash scripts/completion-final.sh >"$TMP_DIR/plane-apply.out" 2>&1
PLANE_APPLY_STATUS=$?
set -e

if [[ "$PLANE_APPLY_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=plane apply dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "PLANE_WRITEBACK_SMOKE_APPLY must be true" "$TMP_DIR/plane-apply.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=plane apply dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
PLANE_WRITEBACK_ENABLED=false \
  bash scripts/completion-final.sh >"$TMP_DIR/plane-writeback-enabled.out" 2>&1
PLANE_WRITEBACK_ENABLED_STATUS=$?
set -e

if [[ "$PLANE_WRITEBACK_ENABLED_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=Plane writeback disabled dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "PLANE_WRITEBACK_ENABLED must be true" "$TMP_DIR/plane-writeback-enabled.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=Plane writeback disabled dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_EXECUTION_PROFILE=openhands-langfuse \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
OPENHANDS_SMOKE_CREATE_CONVERSATION=false \
  bash scripts/completion-final.sh >"$TMP_DIR/openhands-create.out" 2>&1
OPENHANDS_CREATE_STATUS=$?
set -e

if [[ "$OPENHANDS_CREATE_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=OpenHands create dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "OPENHANDS_SMOKE_CREATE_CONVERSATION must be true" "$TMP_DIR/openhands-create.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=OpenHands create dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_EXECUTION_PROFILE=openhands-langfuse \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
OPENHANDS_SMOKE_WAIT_READY=false \
  bash scripts/completion-final.sh >"$TMP_DIR/openhands-wait.out" 2>&1
OPENHANDS_WAIT_STATUS=$?
set -e

if [[ "$OPENHANDS_WAIT_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=OpenHands wait-ready dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "OPENHANDS_SMOKE_WAIT_READY must be true" "$TMP_DIR/openhands-wait.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=OpenHands wait-ready dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_EXECUTION_PROFILE=openhands-langfuse \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF=false \
  bash scripts/completion-final.sh >"$TMP_DIR/openhands-db-trace-ref.out" 2>&1
OPENHANDS_DB_TRACE_REF_STATUS=$?
set -e

if [[ "$OPENHANDS_DB_TRACE_REF_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=OpenHands DB trace ref dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF must be true" "$TMP_DIR/openhands-db-trace-ref.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=OpenHands DB trace ref dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_EXECUTION_PROFILE=openhands-langfuse \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
LANGFUSE_ENABLED=false \
  bash scripts/completion-final.sh >"$TMP_DIR/langfuse-enabled.out" 2>&1
LANGFUSE_ENABLED_STATUS=$?
set -e

if [[ "$LANGFUSE_ENABLED_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=Langfuse disabled dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "LANGFUSE_ENABLED must be true" "$TMP_DIR/langfuse-enabled.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=Langfuse disabled dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_COMPLETION_EXECUTION_PROFILE=openhands-langfuse \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
LANGFUSE_SMOKE_DRY_RUN=true \
  bash scripts/completion-final.sh >"$TMP_DIR/langfuse-dry.out" 2>&1
LANGFUSE_DRY_STATUS=$?
set -e

if [[ "$LANGFUSE_DRY_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=Langfuse dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "LANGFUSE_SMOKE_DRY_RUN must be false" "$TMP_DIR/langfuse-dry.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=Langfuse dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE=true \
  bash scripts/completion-final.sh >"$TMP_DIR/incomplete.out" 2>&1
INCOMPLETE_STATUS=$?
set -e

if [[ "$INCOMPLETE_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow incomplete dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE must not be true" "$TMP_DIR/incomplete.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow incomplete dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING=true \
  bash scripts/completion-final.sh >"$TMP_DIR/allow-missing-preflight.out" 2>&1
ALLOW_MISSING_PREFLIGHT_STATUS=$?
set -e

if [[ "$ALLOW_MISSING_PREFLIGHT_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow-missing preflight dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING must not be true" "$TMP_DIR/allow-missing-preflight.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow-missing preflight dry run did not report final gate violation" >&2
  exit 1
fi

ALLOW_MISSING_ENV_FILE="$TMP_DIR/allow-missing-preflight.env"
cat >"$ALLOW_MISSING_ENV_FILE" <<'EOF'
ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING=true
EOF
chmod 600 "$ALLOW_MISSING_ENV_FILE"

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_SECRET_ENV_FILE="$ALLOW_MISSING_ENV_FILE" \
  bash scripts/completion-final.sh >"$TMP_DIR/allow-missing-preflight-env-file.out" 2>&1
ALLOW_MISSING_ENV_FILE_STATUS=$?
set -e

if [[ "$ALLOW_MISSING_ENV_FILE_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow-missing preflight env file dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING must not be true" "$TMP_DIR/allow-missing-preflight-env-file.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow-missing preflight env file dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_SECRET_COMMAND="printf 'ACP_SMOKE_ENABLE_USER_WRITE=true\\n'" \
  bash scripts/completion-final.sh >"$TMP_DIR/smoke-user-write-secret-command.out" 2>&1
SMOKE_USER_WRITE_SECRET_COMMAND_STATUS=$?
set -e

if [[ "$SMOKE_USER_WRITE_SECRET_COMMAND_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=smoke user write secret command dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_SMOKE_ENABLE_USER_WRITE must not be true" "$TMP_DIR/smoke-user-write-secret-command.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=smoke user write secret command dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_SMOKE_SKIP_SECRET_VALIDATE=true \
  bash scripts/completion-final.sh >"$TMP_DIR/smoke-skip-secret.out" 2>&1
SMOKE_SKIP_SECRET_STATUS=$?
set -e

if [[ "$SMOKE_SKIP_SECRET_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=smoke skip secret dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_SMOKE_SKIP_SECRET_VALIDATE must not be true" "$TMP_DIR/smoke-skip-secret.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=smoke skip secret dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_SMOKE_ENABLE_USER_WRITE=true \
  bash scripts/completion-final.sh >"$TMP_DIR/smoke-user-write.out" 2>&1
SMOKE_USER_WRITE_STATUS=$?
set -e

if [[ "$SMOKE_USER_WRITE_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=smoke user write dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_SMOKE_ENABLE_USER_WRITE must not be true" "$TMP_DIR/smoke-user-write.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=smoke user write dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE=true \
  bash scripts/completion-final.sh >"$TMP_DIR/local-evidence.out" 2>&1
LOCAL_EVIDENCE_STATUS=$?
set -e

if [[ "$LOCAL_EVIDENCE_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow local evidence dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE must not be true" "$TMP_DIR/local-evidence.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow local evidence dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_CUTOVER_ALLOW_LOOPBACK_URLS=true \
  bash scripts/completion-final.sh >"$TMP_DIR/allow-loopback-urls.out" 2>&1
ALLOW_LOOPBACK_URLS_STATUS=$?
set -e

if [[ "$ALLOW_LOOPBACK_URLS_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow loopback URLs dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_CUTOVER_ALLOW_LOOPBACK_URLS must not be true" "$TMP_DIR/allow-loopback-urls.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=allow loopback URLs dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_CUTOVER_REPORT_OVERWRITE=true \
  bash scripts/completion-final.sh >"$TMP_DIR/report-overwrite.out" 2>&1
REPORT_OVERWRITE_STATUS=$?
set -e

if [[ "$REPORT_OVERWRITE_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=report overwrite dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_CUTOVER_REPORT_OVERWRITE must not be true" "$TMP_DIR/report-overwrite.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=report overwrite dry run did not report final gate violation" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_DRY_RUN=true \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
ACP_COMPLETION_AUDIT_REPORT_FILE="$TMP_DIR/stale-report.json" \
  bash scripts/completion-final.sh >"$TMP_DIR/report-mismatch.out" 2>&1
REPORT_MISMATCH_STATUS=$?
set -e

if [[ "$REPORT_MISMATCH_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=report mismatch dry run unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_COMPLETION_AUDIT_REPORT_FILE must match ACP_CUTOVER_REPORT_FILE" "$TMP_DIR/report-mismatch.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=report mismatch dry run did not report final gate violation" >&2
  exit 1
fi

EXISTING_REPORT="$TMP_DIR/existing-cutover-report.json"
printf '{}\n' >"$EXISTING_REPORT"
set +e
ACP_CUTOVER_REPORT_FILE="$EXISTING_REPORT" \
  bash scripts/completion-final.sh >"$TMP_DIR/existing-report.out" 2>&1
EXISTING_REPORT_STATUS=$?
set -e

if [[ "$EXISTING_REPORT_STATUS" -eq 0 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=existing report path unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "ACP_CUTOVER_REPORT_FILE must not already exist" "$TMP_DIR/existing-report.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=existing report path did not report final gate violation" >&2
  exit 1
fi

STUB_BIN="$TMP_DIR/bin"
STUB_LOG="$TMP_DIR/stub-pnpm.log"
mkdir -p "$STUB_BIN"
cat >"$STUB_BIN/pnpm" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >>"${ACP_COMPLETION_FINAL_STUB_LOG:?}"
exit 0
STUB
chmod +x "$STUB_BIN/pnpm"

PATH="$STUB_BIN:$PATH" \
ACP_COMPLETION_FINAL_STUB_LOG="$STUB_LOG" \
ACP_COMPLETION_FINAL_RUN_ID="final-smoke-real-run" \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/final-smoke-real-report.json" \
  bash scripts/completion-final.sh >"$TMP_DIR/final-real.out"

if ! grep -q "^completion_final=running$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print running status" >&2
  exit 1
fi

if [[ "$(grep -c "^completion_execution_profile=codex-cli$" "$TMP_DIR/final-real.out")" -ne 2 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print codex-cli profile at start and completion" >&2
  exit 1
fi

if [[ "$(grep -c "^completion_final_run_id=final-smoke-real-run$" "$TMP_DIR/final-real.out")" -ne 2 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print final run id at start and completion" >&2
  exit 1
fi

if [[ "$(grep -c "^external_preflight_id=external-preflight-final-smoke-real-run$" "$TMP_DIR/final-real.out")" -ne 2 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print bound external preflight id at start and completion" >&2
  exit 1
fi

if [[ "$(grep -c "^cutover_report_id=cutover-report-final-smoke-real-run$" "$TMP_DIR/final-real.out")" -ne 2 ]]; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print bound cutover report id at start and completion" >&2
  exit 1
fi

if ! grep -q "^cutover_report_file=$TMP_DIR/final-smoke-real-report.json$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print report path" >&2
  exit 1
fi

if ! grep -q "^completion_audit_report_file=$TMP_DIR/final-smoke-real-report.json$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print audit report path" >&2
  exit 1
fi

if ! grep -q "^secret_env_file=not-set$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print missing secret env file status" >&2
  exit 1
fi

if ! grep -q "^default_final_env_file=.secrets/completion-final.env$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print default final env file path" >&2
  exit 1
fi

if ! grep -q "^next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:gap$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print default env gap command" >&2
  exit 1
fi

if ! grep -q "^next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm external:preflight$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print default env external preflight command" >&2
  exit 1
fi

if ! grep -q "^next_command_run_final=ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:final$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print default env final command" >&2
  exit 1
fi

if ! grep -q "^completion_final=passed$" "$TMP_DIR/final-real.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not print passed status" >&2
  exit 1
fi

cat >"$TMP_DIR/expected-pnpm.log" <<'EOF'
--silent external:preflight
--silent cutover:check
--silent completion:audit
EOF

if ! diff -u "$TMP_DIR/expected-pnpm.log" "$STUB_LOG" >/dev/null; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry final run did not invoke gates in order" >&2
  diff -u "$TMP_DIR/expected-pnpm.log" "$STUB_LOG" >&2 || true
  exit 1
fi

EXPLICIT_STUB_LOG="$TMP_DIR/explicit-stub-pnpm.log"
PATH="$STUB_BIN:$PATH" \
ACP_COMPLETION_FINAL_STUB_LOG="$EXPLICIT_STUB_LOG" \
ACP_COMPLETION_FINAL_RUN_ID="final-smoke-explicit-env-run" \
ACP_CUTOVER_REPORT_FILE="$TMP_DIR/final-smoke-explicit-env-report.json" \
ACP_SECRET_ENV_FILE="$EXPLICIT_ENV_FILE" \
  bash scripts/completion-final.sh >"$TMP_DIR/final-real-explicit-env.out"

if ! grep -q "^secret_env_file=${EXPLICIT_ENV_FILE}$" "$TMP_DIR/final-real-explicit-env.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry explicit env final run did not print secret env file path" >&2
  exit 1
fi

if ! grep -q "^default_final_env_file_hint=using_explicit_secret_env_file$" "$TMP_DIR/final-real-explicit-env.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry explicit env final run did not print explicit env hint" >&2
  exit 1
fi

if grep -q "^next_command_generate_env_template=" "$TMP_DIR/final-real-explicit-env.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry explicit env final run should not suggest generating default env template" >&2
  exit 1
fi

if ! grep -q "^next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm completion:gap$" "$TMP_DIR/final-real-explicit-env.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry explicit env final run did not print explicit env gap command" >&2
  exit 1
fi

if ! grep -q "^next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm external:preflight$" "$TMP_DIR/final-real-explicit-env.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry explicit env final run did not print explicit env external preflight command" >&2
  exit 1
fi

if ! grep -q "^next_command_run_final=ACP_SECRET_ENV_FILE=${EXPLICIT_ENV_FILE} pnpm completion:final$" "$TMP_DIR/final-real-explicit-env.out"; then
  echo "completion_final_smoke=failed" >&2
  echo "error=non-dry explicit env final run did not print explicit env final command" >&2
  exit 1
fi

echo "completion_final_smoke=passed"
echo "dry_run_defaults_verified=true"
echo "codex_app_server_adapter_accepted=true"
echo "default_report_bound_to_final_run_id=true"
echo "default_preflight_bound_to_final_run_id=true"
echo "explicit_preflight_id_preserved=true"
echo "disabled_required_smoke_rejected=true"
echo "allow_incomplete_rejected=true"
echo "allow_missing_preflight_rejected=true"
echo "allow_missing_preflight_env_file_rejected=true"
echo "smoke_skip_secret_rejected=true"
echo "smoke_user_write_rejected=true"
echo "smoke_user_write_secret_command_rejected=true"
echo "plane_writeback_enabled_required=true"
echo "plane_apply_required=true"
echo "codex_adapter_required=true"
echo "legacy_profile_defaults_verified=true"
echo "legacy_openhands_create_required=true"
echo "legacy_openhands_wait_ready_required=true"
echo "legacy_openhands_db_trace_ref_required=true"
echo "legacy_langfuse_enabled_required=true"
echo "legacy_langfuse_dry_run_rejected=true"
echo "worker_temp_db_required=true"
echo "allow_local_evidence_rejected=true"
echo "allow_loopback_urls_rejected=true"
echo "report_overwrite_rejected=true"
echo "report_mismatch_rejected=true"
echo "existing_report_rejected=true"
echo "external_preflight_command_output_verified=true"
echo "non_dry_run_id_output_verified=true"
echo "non_dry_preflight_id_output_verified=true"
echo "non_dry_secret_env_output_verified=true"
echo "non_dry_gate_order_verified=true"
