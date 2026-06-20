#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-cutover-report.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

REPORT_FILE="$TMP_DIR/failed-cutover-report.json"
TEMPLATE_REPORT_FILE="$TMP_DIR/template-cutover-report.json"
LOOPBACK_REPORT_FILE="$TMP_DIR/loopback-cutover-report.json"
PRODUCTION_FAILURE_REPORT_FILE="$TMP_DIR/production-failure-cutover-report.json"
TASK_SOURCE_SMOKE_REPORT_FILE="$TMP_DIR/task-source-smoke-cutover-report.json"
CODEX_APP_SERVER_SMOKE_REPORT_FILE="$TMP_DIR/codex-app-server-smoke-cutover-report.json"
MANUAL_ENV_REPORT_FILE="$TMP_DIR/manual-env-cutover-report.json"
SECRET_ENV_REPORT_FILE="$TMP_DIR/secret-env-existing-report.json"
PRODUCTION_SECRET_ENV_FILE="$TMP_DIR/production-smoke.env"
MANUAL_ENV_FILE="$TMP_DIR/manual-evidence.env"
SECRET_ENV_REPORT_ENV_FILE="$TMP_DIR/secret-env-report.env"
TEMPLATE_ENV_FILE="$TMP_DIR/final-template.env"
FAKE_BIN_DIR="$TMP_DIR/fake-bin"
OUTPUT_FILE="$TMP_DIR/cutover-check.out"
TEMPLATE_OUTPUT_FILE="$TMP_DIR/template-cutover-check.out"
LOOPBACK_OUTPUT_FILE="$TMP_DIR/loopback-cutover-check.out"
PRODUCTION_FAILURE_OUTPUT_FILE="$TMP_DIR/production-failure-cutover-check.out"
TASK_SOURCE_SMOKE_OUTPUT_FILE="$TMP_DIR/task-source-smoke-cutover-check.out"
CODEX_APP_SERVER_SMOKE_OUTPUT_FILE="$TMP_DIR/codex-app-server-smoke-cutover-check.out"
PRODUCTION_SECRET_ENV_OUTPUT_FILE="$TMP_DIR/production-secret-env-smoke.out"
MANUAL_ENV_OUTPUT_FILE="$TMP_DIR/manual-env-cutover-check.out"
FINAL_RUN_ID="cutover-report-smoke"
REPORT_ID="cutover-report-smoke-id"

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_CUTOVER_REPORT_FILE="$REPORT_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID" \
  ACP_CUTOVER_REPORT_ID="$REPORT_ID" \
  bash scripts/cutover-check.sh >"$OUTPUT_FILE" 2>&1
CUTOVER_STATUS=$?
set -e

if [[ "$CUTOVER_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check unexpectedly passed with missing configuration" >&2
  exit 1
fi

if ! grep -q "cutover_readiness=failed" "$OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not emit failed readiness" >&2
  exit 1
fi

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_CUTOVER_REPORT_FILE="$REPORT_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID" \
  ACP_CUTOVER_REPORT_ID="$REPORT_ID" \
  bash scripts/cutover-check.sh >"$TMP_DIR/existing-report.out" 2>&1
EXISTING_REPORT_STATUS=$?
set -e

if [[ "$EXISTING_REPORT_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check unexpectedly overwrote an existing report" >&2
  exit 1
fi

if ! grep -q "ACP_CUTOVER_REPORT_FILE already exists" "$TMP_DIR/existing-report.out"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not reject existing report path" >&2
  exit 1
fi

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_CUTOVER_REPORT_FILE="$REPORT_FILE" \
  ACP_CUTOVER_REPORT_OVERWRITE=true \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID" \
  ACP_CUTOVER_REPORT_ID="$REPORT_ID" \
  bash scripts/cutover-check.sh >"$TMP_DIR/overwrite-report.out" 2>&1
OVERWRITE_REPORT_STATUS=$?
set -e

if [[ "$OVERWRITE_REPORT_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check unexpectedly passed with missing configuration during overwrite smoke" >&2
  exit 1
fi

if ! grep -q "cutover_readiness=failed" "$TMP_DIR/overwrite-report.out"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check overwrite mode did not continue to normal failed readiness" >&2
  exit 1
fi

cat >"$SECRET_ENV_REPORT_FILE" <<'EOF'
{"existing":true}
EOF
chmod 600 "$SECRET_ENV_REPORT_FILE"
cat >"$SECRET_ENV_REPORT_ENV_FILE" <<EOF
ACP_CUTOVER_REPORT_FILE="$SECRET_ENV_REPORT_FILE"
EOF
chmod 600 "$SECRET_ENV_REPORT_ENV_FILE"

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$SECRET_ENV_REPORT_ENV_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID-secret-env" \
  ACP_CUTOVER_REPORT_ID="$REPORT_ID-secret-env" \
  bash scripts/cutover-check.sh >"$TMP_DIR/secret-env-existing-report.out" 2>&1
SECRET_ENV_EXISTING_REPORT_STATUS=$?
set -e

if [[ "$SECRET_ENV_EXISTING_REPORT_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check unexpectedly overwrote report path loaded from secret env" >&2
  exit 1
fi

if ! grep -q "ACP_CUTOVER_REPORT_FILE already exists" "$TMP_DIR/secret-env-existing-report.out"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not reject existing report path loaded from secret env" >&2
  exit 1
fi

if ! grep -q '"existing":true' "$SECRET_ENV_REPORT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check changed existing report path loaded from secret env" >&2
  exit 1
fi

ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE="$TEMPLATE_ENV_FILE" \
  bash scripts/completion-final-env-template.sh >/dev/null

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$TEMPLATE_ENV_FILE" \
  ACP_CUTOVER_REPORT_FILE="$TEMPLATE_REPORT_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID-template" \
  bash scripts/cutover-check.sh >"$TEMPLATE_OUTPUT_FILE" 2>&1
TEMPLATE_CUTOVER_STATUS=$?
set -e

if [[ "$TEMPLATE_CUTOVER_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check unexpectedly passed with template placeholders" >&2
  exit 1
fi

if ! grep -q "template placeholder" "$TEMPLATE_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not reject template placeholders" >&2
  exit 1
fi

if grep -q "ACP_SECRET_COMMAND: command failed" "$TEMPLATE_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check tried to execute placeholder secret command" >&2
  exit 1
fi

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  DATABASE_URL="postgresql://agent:agent@localhost:54329/acp" \
  PLANE_BASE_URL="http://localhost:3200" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_COMPLETION_EXECUTION_PROFILE="legacy-openhands" \
  WORKER_EXECUTION_ADAPTER="openhands-cloud" \
  LANGFUSE_ENABLED="true" \
  ACP_CUTOVER_REPORT_FILE="$LOOPBACK_REPORT_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID-loopback" \
  ACP_CUTOVER_PLANE_WRITEBACK_SMOKE_PASSED="true" \
  ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE="work_item_id=issue-1;verified=true" \
  ACP_CUTOVER_OPENHANDS_SMOKE_PASSED="true" \
  ACP_CUTOVER_OPENHANDS_CONVERSATION_URL="http://127.0.0.1:3000/conversation/local" \
  ACP_CUTOVER_LANGFUSE_SMOKE_PASSED="true" \
  ACP_CUTOVER_LANGFUSE_TRACE_URL="http://[::1]:3001/project/proj/traces/local" \
  ACP_CUTOVER_TASK_SOURCE_SMOKE_PASSED="true" \
  ACP_CUTOVER_TASK_SOURCE_EVIDENCE="checked=1;plane_urls=1;linear_urls=0;routed=1;runs=1;conversations=1;traces=1" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="disabled since 2026-06-19" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived read-only on 2026-06-19" \
  bash scripts/cutover-check.sh >"$LOOPBACK_OUTPUT_FILE" 2>&1
LOOPBACK_CUTOVER_STATUS=$?
set -e

if [[ "$LOOPBACK_CUTOVER_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check unexpectedly passed with loopback manual URLs" >&2
  exit 1
fi

for expected in \
  "PLANE_BASE_URL: must not use loopback URL" \
  "ACP_CUTOVER_OPENHANDS_CONVERSATION_URL: must not use loopback URL" \
  "ACP_CUTOVER_LANGFUSE_TRACE_URL: must not use loopback URL"; do
  if ! grep -q "$expected" "$LOOPBACK_OUTPUT_FILE"; then
    echo "cutover_report_smoke=failed" >&2
    echo "error=cutover check did not reject ${expected%%:*} loopback URL" >&2
    exit 1
  fi
done

if ! grep -q "must not use loopback URL" "$LOOPBACK_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not reject loopback manual URLs" >&2
  exit 1
fi

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  DATABASE_URL="postgresql://agent:agent@localhost:54329/acp" \
  PLANE_BASE_URL="https://plane.invalid" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  WORKER_EXECUTION_ADAPTER="openhands-cloud" \
  LANGFUSE_ENABLED="true" \
  ACP_CUTOVER_REPORT_FILE="$PRODUCTION_FAILURE_REPORT_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID-production-failure" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="true" \
  ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true" \
  ACP_SMOKE_EXTERNAL="true" \
  ACP_SMOKE_BASE_URL="http://127.0.0.1:9" \
  ACP_CUTOVER_PLANE_WRITEBACK_SMOKE_PASSED="true" \
  ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE="work_item_id=issue-1;verified=true" \
  ACP_CUTOVER_OPENHANDS_SMOKE_PASSED="true" \
  ACP_CUTOVER_OPENHANDS_CONVERSATION_URL="https://openhands.invalid/conversation/real" \
  ACP_CUTOVER_LANGFUSE_SMOKE_PASSED="true" \
  ACP_CUTOVER_LANGFUSE_TRACE_URL="https://langfuse.invalid/project/proj/traces/real" \
  ACP_CUTOVER_TASK_SOURCE_SMOKE_PASSED="true" \
  ACP_CUTOVER_TASK_SOURCE_EVIDENCE="checked=1;plane_urls=1;linear_urls=0;routed=1;runs=1;conversations=1;traces=1" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="disabled since 2026-06-19" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived read-only on 2026-06-19" \
  bash scripts/cutover-check.sh >"$PRODUCTION_FAILURE_OUTPUT_FILE" 2>&1
PRODUCTION_FAILURE_STATUS=$?
set -e

if [[ "$PRODUCTION_FAILURE_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check unexpectedly passed when production smoke failed" >&2
  exit 1
fi

if ! grep -q "smoke: production smoke failed" "$PRODUCTION_FAILURE_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not record production smoke failure" >&2
  exit 1
fi

cat >"$PRODUCTION_SECRET_ENV_FILE" <<'EOF'
DATABASE_URL=postgresql://agent:agent@localhost:54329/acp
ACP_OPERATOR_API_TOKEN=production-smoke-operator-token-fixture-0001
ACP_OPERATOR_LOGIN_PASSWORD=production-smoke-login-password-fixture-0001
ACP_OPERATOR_SESSION_SECRET=production-smoke-session-secret-fixture-0001
PLANE_WEBHOOK_SECRET=production-smoke-plane-webhook-fixture-0001
PLANE_WRITEBACK_ENABLED=true
PLANE_BASE_URL=https://plane.invalid
PLANE_WORKSPACE_SLUG=workspace
PLANE_PROJECT_ID=project
PLANE_API_KEY=production-smoke-plane-api-key-fixture-0001
WORKER_EXECUTION_ADAPTER=openhands-cloud
OPENHANDS_BASE_URL=https://openhands.invalid
OPENHANDS_API_KEY=production-smoke-openhands-key-fixture-0001
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=https://langfuse.invalid
LANGFUSE_PROJECT_ID=project
LANGFUSE_PUBLIC_KEY=production-smoke-langfuse-public-fixture-0001
LANGFUSE_SECRET_KEY=production-smoke-langfuse-secret-fixture-0001
ACP_SECRET_EXPIRES_AT=2099-01-01T00:00:00.000Z
ACP_SECRET_ROTATED_AT=2026-06-19T00:00:00.000Z
EOF
chmod 600 "$PRODUCTION_SECRET_ENV_FILE"

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_ENV="production" \
  ACP_SECRET_ENV_FILE="$PRODUCTION_SECRET_ENV_FILE" \
  ACP_SMOKE_BASE_URL="http://127.0.0.1:9" \
  bash scripts/smoke-production.sh >"$PRODUCTION_SECRET_ENV_OUTPUT_FILE" 2>&1
PRODUCTION_SECRET_ENV_STATUS=$?
set -e

if [[ "$PRODUCTION_SECRET_ENV_STATUS" -eq 0 ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=production smoke unexpectedly passed against closed local port" >&2
  exit 1
fi

if grep -q "secret_validation=failed" "$PRODUCTION_SECRET_ENV_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=production smoke validated secrets before loading ACP_SECRET_ENV_FILE" >&2
  exit 1
fi

if ! grep -q "smoke_step=secret_validate" "$PRODUCTION_SECRET_ENV_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=production smoke did not run secret validation" >&2
  exit 1
fi

if ! grep -q "smoke_failed=readiness:curl_error" "$PRODUCTION_SECRET_ENV_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=production smoke did not progress past secret env loading to readiness" >&2
  exit 1
fi

mkdir -p "$FAKE_BIN_DIR"
cat >"$FAKE_BIN_DIR/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == *" build"* ]]; then
  exit 0
fi

if [[ "$*" == *"codex:app-server-smoke"* ]]; then
  echo "codex_app_server_adapter_smoke=passed"
  echo "summary=codex app-server smoke passed"
  echo "next_state=Code Review"
  echo "events=4"
  echo "conversation_provider=codex-app-server"
  exit 0
fi

if [[ "$*" == *"task-source:smoke"* ]]; then
  echo "task_source_smoke=passed"
  echo "checked=2"
  echo "plane_url_count=2"
  echo "linear_url_count=0"
  echo "routed_count=2"
  echo "run_evidence_count=2"
  echo "run_event_count=2"
  echo "progress_item_count=2"
  echo "conversation_evidence_count=0"
  echo "trace_evidence_count=0"
  echo "violations=0"
  exit 0
fi

echo "fake pnpm only supports db build, codex:app-server-smoke, and task-source:smoke in this smoke" >&2
exit 1
EOF
chmod 700 "$FAKE_BIN_DIR/pnpm"

env -i \
  PATH="$FAKE_BIN_DIR:$PATH" \
  HOME="$HOME" \
  DATABASE_URL="postgresql://agent:agent@localhost:54329/acp" \
  PLANE_BASE_URL="https://plane.invalid" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_COMPLETION_EXECUTION_PROFILE="codex-cli" \
  WORKER_EXECUTION_ADAPTER="codex-cli" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="true" \
  ACP_CUTOVER_REPORT_FILE="$TASK_SOURCE_SMOKE_REPORT_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID-task-source-smoke" \
  ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true" \
  ACP_CUTOVER_PLANE_WRITEBACK_SMOKE_PASSED="true" \
  ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE="work_item_id=issue-1;state=Human Review;verified=true" \
  ACP_CUTOVER_TASK_SOURCE_SMOKE_PASSED="true" \
  ACP_CUTOVER_TASK_SOURCE_EVIDENCE="checked=2;plane_urls=2;linear_urls=0;routed=2;runs=2;run_events=2;progress_items=2" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="disabled since 2026-06-19" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived read-only on 2026-06-19" \
  bash scripts/cutover-check.sh >"$TASK_SOURCE_SMOKE_OUTPUT_FILE"

if ! grep -q "cutover_readiness=passed" "$TASK_SOURCE_SMOKE_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not pass with codex task-source smoke evidence" >&2
  cat "$TASK_SOURCE_SMOKE_OUTPUT_FILE" >&2
  exit 1
fi

node - "$TASK_SOURCE_SMOKE_REPORT_FILE" <<'NODE'
const fs = require("node:fs");
const [reportFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

function assert(condition, message) {
  if (!condition) {
    console.error(`cutover_report_error=${message}`);
    process.exit(1);
  }
}

assert(report.readiness === "passed", "task-source smoke cutover report readiness must be passed");
assert(
  report.evidence?.taskSource ===
    "checked=2;plane_urls=2;linear_urls=0;routed=2;runs=2;run_events=2;progress_items=2;conversations=0;traces=0",
  "task-source smoke evidence must include run_events and progress_items",
);
assert(report.config?.completionExecutionProfile === "codex-cli", "codex profile must be recorded");
NODE

env -i \
  PATH="$FAKE_BIN_DIR:$PATH" \
  HOME="$HOME" \
  DATABASE_URL="postgresql://agent:agent@localhost:54329/acp" \
  PLANE_BASE_URL="https://plane.invalid" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_COMPLETION_EXECUTION_PROFILE="codex-cli" \
  WORKER_EXECUTION_ADAPTER="codex-app-server" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="true" \
  ACP_CUTOVER_REPORT_FILE="$CODEX_APP_SERVER_SMOKE_REPORT_FILE" \
  ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID-codex-app-server-smoke" \
  ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="true" \
  ACP_CUTOVER_PLANE_WRITEBACK_SMOKE_PASSED="true" \
  ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE="work_item_id=issue-1;state=Human Review;verified=true" \
  ACP_CUTOVER_TASK_SOURCE_SMOKE_PASSED="true" \
  ACP_CUTOVER_TASK_SOURCE_EVIDENCE="checked=2;plane_urls=2;linear_urls=0;routed=2;runs=2;run_events=2;progress_items=2" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="disabled since 2026-06-19" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived read-only on 2026-06-19" \
  bash scripts/cutover-check.sh >"$CODEX_APP_SERVER_SMOKE_OUTPUT_FILE"

if ! grep -q "cutover_readiness=passed" "$CODEX_APP_SERVER_SMOKE_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not pass with codex-app-server adapter smoke evidence" >&2
  cat "$CODEX_APP_SERVER_SMOKE_OUTPUT_FILE" >&2
  exit 1
fi

node - "$CODEX_APP_SERVER_SMOKE_REPORT_FILE" <<'NODE'
const fs = require("node:fs");
const [reportFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

function assert(condition, message) {
  if (!condition) {
    console.error(`cutover_report_error=${message}`);
    process.exit(1);
  }
}

assert(report.readiness === "passed", "codex app-server smoke cutover report readiness must be passed");
assert(report.config?.completionExecutionProfile === "codex-cli", "codex profile must be recorded");
assert(report.config?.workerExecutionAdapter === "codex-app-server", "codex app-server worker adapter must be recorded");
assert(
  report.evidence?.codexAdapter ===
    "provider=codex-app-server;next_state=Code Review;events=4;summary=codex app-server smoke passed",
  "codex app-server smoke evidence must be recorded",
);
NODE

cat >"$MANUAL_ENV_FILE" <<'EOF'
DATABASE_URL=postgresql://agent:agent@localhost:54329/acp
PLANE_BASE_URL=https://plane.invalid
PLANE_WORKSPACE_SLUG=workspace
PLANE_PROJECT_ID=project
PLANE_API_KEY=plane-key-fixture
PLANE_WEBHOOK_SECRET=plane-webhook-fixture
PLANE_WRITEBACK_ENABLED=true
ACP_OPERATOR_API_TOKEN=operator-token-fixture
WORKER_EXECUTION_ADAPTER=openhands-cloud
LANGFUSE_ENABLED=true
ACP_CUTOVER_SKIP_SECRET_VALIDATE=true
ACP_CUTOVER_PLANE_WRITEBACK_SMOKE_PASSED=true
ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE=work_item_id=env-file-issue;state=Human Review;verified=true
ACP_CUTOVER_OPENHANDS_SMOKE_PASSED=true
ACP_CUTOVER_OPENHANDS_CONVERSATION_URL=https://openhands.invalid/conversations/env-file
ACP_CUTOVER_LANGFUSE_SMOKE_PASSED=true
ACP_CUTOVER_LANGFUSE_TRACE_URL=https://langfuse.invalid/project/proj/traces/env-file
ACP_CUTOVER_TASK_SOURCE_SMOKE_PASSED=true
ACP_CUTOVER_TASK_SOURCE_EVIDENCE=checked=2;plane_urls=2;linear_urls=0;routed=2;runs=2;conversations=2;traces=2
ACP_CUTOVER_LEGACY_POLLER_READONLY=true
ACP_CUTOVER_LEGACY_POLLER_EVIDENCE=disabled old poller on 2026-06-19
ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED=true
ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE=archived read-only on 2026-06-19
ACP_CUTOVER_MANUAL_EVIDENCE_SUMMARY=manual env evidence bundle
EOF
chmod 600 "$MANUAL_ENV_FILE"

ACP_SECRET_ENV_FILE="$MANUAL_ENV_FILE" \
ACP_CUTOVER_REPORT_FILE="$MANUAL_ENV_REPORT_FILE" \
ACP_COMPLETION_FINAL_RUN_ID="$FINAL_RUN_ID-manual-env" \
  bash scripts/cutover-check.sh >"$MANUAL_ENV_OUTPUT_FILE"

if ! grep -q "cutover_readiness=passed" "$MANUAL_ENV_OUTPUT_FILE"; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not pass with manual evidence from secret env file" >&2
  cat "$MANUAL_ENV_OUTPUT_FILE" >&2
  exit 1
fi

node - "$MANUAL_ENV_REPORT_FILE" <<'NODE'
const fs = require("node:fs");
const [reportFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

function assert(condition, message) {
  if (!condition) {
    console.error(`cutover_report_error=${message}`);
    process.exit(1);
  }
}

assert(report.readiness === "passed", "manual env cutover report readiness must be passed");
assert(
  report.evidence?.planeWriteback === "work_item_id=env-file-issue;state=Human Review;verified=true",
  "manual env Plane evidence was not recorded",
);
assert(
  report.evidence?.openhandsConversation === "https://openhands.invalid/conversations/env-file",
  "manual env OpenHands evidence was not recorded",
);
assert(
  report.evidence?.langfuseTrace === "https://langfuse.invalid/project/proj/traces/env-file",
  "manual env Langfuse evidence was not recorded",
);
assert(
  report.evidence?.taskSource === "checked=2;plane_urls=2;linear_urls=0;routed=2;runs=2;conversations=2;traces=2",
  "manual env task-source evidence was not recorded",
);
assert(report.evidence?.manualSummary === "manual env evidence bundle", "manual summary was not recorded");
NODE

if [[ ! -f "$REPORT_FILE" ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover check did not write failed report" >&2
  exit 1
fi

mode="$(stat -f '%Lp' "$REPORT_FILE" 2>/dev/null || stat -c '%a' "$REPORT_FILE" 2>/dev/null || printf '')"
if [[ "$mode" != "600" ]]; then
  echo "cutover_report_smoke=failed" >&2
  echo "error=cutover report permissions are ${mode:-unknown}, expected 600" >&2
  exit 1
fi

node - "$REPORT_FILE" "$FINAL_RUN_ID" "$REPORT_ID" <<'NODE'
const fs = require("node:fs");
const [reportFile, finalRunId, reportId] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

function assert(condition, message) {
  if (!condition) {
    console.error(`cutover_report_error=${message}`);
    process.exit(1);
  }
}

assert(report.readiness === "failed", "readiness must be failed");
assert(typeof report.reportId === "string" && report.reportId.length > 0, "reportId must be non-empty");
assert(report.reportId === reportId, "reportId must honor ACP_CUTOVER_REPORT_ID");
assert(report.completionFinalRunId === finalRunId, "completionFinalRunId must match");
assert(Array.isArray(report.errors) && report.errors.length > 0, "errors must be non-empty");
assert(Array.isArray(report.warnings), "warnings must be an array");
assert(report.gates && typeof report.gates === "object", "gates missing");
assert(report.smoke && typeof report.smoke === "object", "smoke missing");
assert(report.evidence && typeof report.evidence === "object", "evidence missing");
assert(report.config && typeof report.config === "object", "config missing");
NODE

node - "$PRODUCTION_FAILURE_REPORT_FILE" <<'NODE'
const fs = require("node:fs");
const [reportFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

function assert(condition, message) {
  if (!condition) {
    console.error(`cutover_report_error=${message}`);
    process.exit(1);
  }
}

assert(report.readiness === "failed", "production smoke failure readiness must be failed");
assert(
  Array.isArray(report.errors) && report.errors.includes("smoke: production smoke failed"),
  "production smoke failure must be recorded in errors",
);
assert(
  report.evidence?.productionSmoke === "not-run",
  "failed production smoke must not synthesize partial production evidence",
);
NODE

echo "cutover_report_smoke=passed"
echo "failed_report_written=true"
echo "failed_report_permissions=600"
echo "failed_report_final_run_id_bound=true"
echo "failed_report_id_bound=true"
echo "existing_report_rejected=true"
echo "report_overwrite_explicitly_allowed=true"
echo "secret_env_report_rejected=true"
echo "template_placeholders_rejected=true"
echo "loopback_manual_urls_rejected=true"
echo "loopback_plane_url_rejected=true"
echo "production_smoke_failure_recorded=true"
echo "production_smoke_secret_env_loaded_before_validate=true"
echo "task_source_smoke_evidence_recorded=true"
echo "manual_evidence_secret_env_recorded=true"
