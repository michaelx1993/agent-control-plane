#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-final-env-template-smoke.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

STDOUT_FILE="$TMP_DIR/stdout.env"
OUTPUT_FILE="$TMP_DIR/final.env"
STALE_OUTPUT_FILE="$TMP_DIR/stale-final.env"
WRITE_OUTPUT="$TMP_DIR/write.out"
EXISTING_OUTPUT="$TMP_DIR/existing.out"
APPEND_OUTPUT="$TMP_DIR/append.out"

bash scripts/completion-final-env-template.sh >"$STDOUT_FILE"

for expected in \
  'ACP_COMPLETION_EXECUTION_PROFILE="codex-cli"' \
  'WORKER_EXECUTION_ADAPTER="codex-cli"' \
  'Final cutover strict secret validation requires all three values below.' \
  'ACP_OPERATOR_API_TOKEN="<operator-token>"' \
  'ACP_OPERATOR_LOGIN_PASSWORD="<operator-login-password>"' \
  'ACP_OPERATOR_SESSION_SECRET="<operator-session-secret>"' \
  'PLANE_WRITEBACK_SMOKE_APPLY="true"' \
  'ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="true"' \
  'ACP_CUTOVER_RUN_OPENHANDS_SMOKE="false"' \
  'ACP_CUTOVER_RUN_LANGFUSE_SMOKE="false"' \
  'TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE="false"' \
  'ACP_SMOKE_EXTERNAL="false"' \
  'ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true"' \
  '# WORKER_EXECUTION_ADAPTER="openhands-cloud"' \
  '# OPENHANDS_SMOKE_CREATE_CONVERSATION="true"' \
  '# OPENHANDS_SMOKE_WAIT_READY="true"' \
  '# OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF="true"' \
  '# LANGFUSE_SMOKE_DRY_RUN="false"' \
  'ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true"' \
  'ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true"' \
  'ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="true"' \
  'ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING="false"' \
  'ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE="false"' \
  'ACP_CUTOVER_LEGACY_POLLER_READONLY="false"' \
  'ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="false"'; do
  if ! grep -q "$expected" "$STDOUT_FILE"; then
    echo "completion_final_env_template_smoke=failed" >&2
    echo "error=stdout template missing ${expected}" >&2
    exit 1
  fi
done

for forbidden in \
  '^ACP_COMPLETION_FINAL_RUN_ID=""$' \
  '^ACP_EXTERNAL_PREFLIGHT_ID=""$' \
  '^ACP_CUTOVER_REPORT_ID=""$' \
  '^ACP_COMPLETION_AUDIT_REPORT_FILE=""$'; do
  if grep -q "$forbidden" "$STDOUT_FILE"; then
    echo "completion_final_env_template_smoke=failed" >&2
    echo "error=stdout template contains dangerous empty binding ${forbidden}" >&2
    exit 1
  fi
done

if grep -q '\$(' "$STDOUT_FILE" || grep -q '`' "$STDOUT_FILE"; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=stdout template contains shell command substitution syntax" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE="$OUTPUT_FILE" \
  bash scripts/completion-final-env-template.sh >"$WRITE_OUTPUT"

if ! grep -q "^completion_final_env_template=written$" "$WRITE_OUTPUT"; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=file write did not report success" >&2
  cat "$WRITE_OUTPUT" >&2
  exit 1
fi

mode="$(stat -f '%Lp' "$OUTPUT_FILE" 2>/dev/null || stat -c '%a' "$OUTPUT_FILE" 2>/dev/null || printf '')"
if [[ "$mode" != "600" ]]; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=expected output mode 600, got ${mode:-unknown}" >&2
  exit 1
fi

set +e
ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE="$OUTPUT_FILE" \
  bash scripts/completion-final-env-template.sh >"$EXISTING_OUTPUT" 2>&1
EXISTING_STATUS=$?
set -e

if [[ "$EXISTING_STATUS" -eq 0 ]]; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=existing file was overwritten without force" >&2
  exit 1
fi

if ! grep -q "output file already exists" "$EXISTING_OUTPUT"; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=existing file failure message missing" >&2
  cat "$EXISTING_OUTPUT" >&2
  exit 1
fi

grep -v -E '^(ACP_CUTOVER_LEGACY_POLLER_READONLY|ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED)=' "$STDOUT_FILE" \
  | sed 's/^ACP_OPERATOR_API_TOKEN=.*/ACP_OPERATOR_API_TOKEN="real-token"/' >"$STALE_OUTPUT_FILE"
chmod 644 "$STALE_OUTPUT_FILE"

ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE="$STALE_OUTPUT_FILE" \
ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING="true" \
  bash scripts/completion-final-env-template.sh >"$APPEND_OUTPUT"

if ! grep -q "^completion_final_env_template=appended_missing$" "$APPEND_OUTPUT"; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=append-missing did not report success" >&2
  cat "$APPEND_OUTPUT" >&2
  exit 1
fi

if ! grep -q "^completion_final_env_template_missing_count=2$" "$APPEND_OUTPUT"; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=append-missing did not report two missing variables" >&2
  cat "$APPEND_OUTPUT" >&2
  exit 1
fi

if ! grep -q "^completion_final_env_template_missing_variables=ACP_CUTOVER_LEGACY_POLLER_READONLY,ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED$" "$APPEND_OUTPUT"; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=append-missing did not report expected missing variables" >&2
  cat "$APPEND_OUTPUT" >&2
  exit 1
fi

append_mode="$(stat -f '%Lp' "$STALE_OUTPUT_FILE" 2>/dev/null || stat -c '%a' "$STALE_OUTPUT_FILE" 2>/dev/null || printf '')"
if [[ "$append_mode" != "600" ]]; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=expected append-missing output mode 600, got ${append_mode:-unknown}" >&2
  exit 1
fi

for expected_appended in \
  'ACP_CUTOVER_LEGACY_POLLER_READONLY="false"' \
  'ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="false"'; do
  if ! grep -q "$expected_appended" "$STALE_OUTPUT_FILE"; then
    echo "completion_final_env_template_smoke=failed" >&2
    echo "error=append-missing did not add ${expected_appended}" >&2
    cat "$STALE_OUTPUT_FILE" >&2
    exit 1
  fi
done

if [[ "$(grep -c '^ACP_OPERATOR_API_TOKEN=' "$STALE_OUTPUT_FILE")" != "1" ]] || ! grep -q '^ACP_OPERATOR_API_TOKEN="real-token"$' "$STALE_OUTPUT_FILE"; then
  echo "completion_final_env_template_smoke=failed" >&2
  echo "error=append-missing overwrote or duplicated an existing variable" >&2
  cat "$STALE_OUTPUT_FILE" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE="$OUTPUT_FILE" \
ACP_COMPLETION_FINAL_ENV_TEMPLATE_FORCE="true" \
  bash scripts/completion-final-env-template.sh >/dev/null

echo "completion_final_env_template_smoke=passed"
