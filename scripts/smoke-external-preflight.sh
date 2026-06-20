#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-external-preflight.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

MISSING_OUTPUT="$TMP_DIR/missing.out"
ALLOW_MISSING_OUTPUT="$TMP_DIR/allow-missing.out"
READY_OUTPUT="$TMP_DIR/ready.out"
EVIDENCE_ONLY_OUTPUT="$TMP_DIR/evidence-only.out"
BAD_REAL_BEHAVIOR_OUTPUT="$TMP_DIR/bad-real-behavior.out"
TEMPLATE_PLACEHOLDER_OUTPUT="$TMP_DIR/template-placeholder.out"
LOOPBACK_URL_OUTPUT="$TMP_DIR/loopback-url.out"
UNSAFE_ENV_OUTPUT="$TMP_DIR/unsafe-env.out"
DEFAULT_TEMPLATE_COMMAND="ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=.secrets/completion-final.env pnpm completion:final-env-template"
if [[ -f .secrets/completion-final.env ]]; then
  DEFAULT_TEMPLATE_COMMAND="ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=.secrets/completion-final.env ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template"
fi

set +e
env -i PATH="$PATH" HOME="$HOME" bash scripts/external-smoke-preflight.sh >"$MISSING_OUTPUT" 2>&1
MISSING_STATUS=$?
set -e

if [[ "$MISSING_STATUS" -eq 0 ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=missing configuration unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "external_smoke_preflight=failed" "$MISSING_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=missing configuration did not emit failed status" >&2
  exit 1
fi

if ! grep -Eq "^external_preflight_id=external-preflight-.+$" "$MISSING_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=missing configuration did not emit preflight id" >&2
  exit 1
fi

if grep -E -q "(plane-key|openhands-key|langfuse-secret|operator-token)" "$MISSING_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=preflight output leaked a secret-shaped fixture" >&2
  exit 1
fi

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING=true \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-allow-missing" \
  ACP_EXTERNAL_PREFLIGHT_REPORT_FILE="$TMP_DIR/allow-missing-report.json" \
  bash scripts/external-smoke-preflight.sh >"$ALLOW_MISSING_OUTPUT"

if ! grep -q "external_smoke_preflight=failed" "$ALLOW_MISSING_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=allow-missing run did not preserve failed status" >&2
  exit 1
fi

missing_count="$(awk -F= '$1 == "missing_count" { print $2 }' "$ALLOW_MISSING_OUTPUT")"
if [[ -z "${missing_count:-}" || "$missing_count" -le 0 ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=allow-missing run did not report missing items" >&2
  exit 1
fi

if ! grep -q "^external_preflight_id=external-preflight-allow-missing$" "$ALLOW_MISSING_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=allow-missing run did not honor preflight id" >&2
  exit 1
fi

DEFAULT_TEMPLATE_COMMAND="$DEFAULT_TEMPLATE_COMMAND" node - "$TMP_DIR/allow-missing-report.json" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const mode = (fs.statSync(reportFile).mode & 0o777).toString(8);
if (mode !== "600") throw new Error(`expected report mode 600, got ${mode}`);
if (report.preflightId !== "external-preflight-allow-missing") throw new Error("bad preflight id");
if (report.status !== "failed") throw new Error("allow-missing report must preserve failed status");
if (!Array.isArray(report.missing) || report.missing.length <= 0) throw new Error("missing list absent");
if (report.missingCount !== report.missing.length) throw new Error("missing count mismatch");
if (!Array.isArray(report.checks) || report.checks.length <= 0) throw new Error("checks list absent");
if (!report.checks.some((check) => check.scope === "cutover_gate" && check.status === "missing")) {
  throw new Error("missing report did not group cutover_gate failures");
}
if (!Array.isArray(report.scopeSummary) || report.scopeSummary.length <= 0) {
  throw new Error("scope summary absent");
}
if (!report.scopeSummary.some((scope) => scope.scope === "cutover_gate" && scope.missing > 0)) {
  throw new Error("scope summary did not count cutover_gate failures");
}
if (
  !Array.isArray(report.nextCommands) ||
  !report.nextCommands.includes(process.env.DEFAULT_TEMPLATE_COMMAND) ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm external:preflight") ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:gap") ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:final")
) {
  throw new Error("next command plan absent");
}
NODE

ALLOW_MISSING_ENV_FILE="$TMP_DIR/allow-missing.env"
cat >"$ALLOW_MISSING_ENV_FILE" <<'EOF'
ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING=true
ACP_EXTERNAL_PREFLIGHT_ID=external-preflight-env-file
EOF
chmod 600 "$ALLOW_MISSING_ENV_FILE"

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$ALLOW_MISSING_ENV_FILE" \
  ACP_EXTERNAL_PREFLIGHT_REPORT_FILE="$TMP_DIR/allow-missing-env-file-report.json" \
  bash scripts/external-smoke-preflight.sh >"$TMP_DIR/allow-missing-env-file.out"

if ! grep -q "external_smoke_preflight=failed" "$TMP_DIR/allow-missing-env-file.out"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=allow-missing env file run did not preserve failed status" >&2
  exit 1
fi

if ! grep -q "^external_preflight_id=external-preflight-env-file$" "$TMP_DIR/allow-missing-env-file.out"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=allow-missing env file run did not honor env-file preflight id" >&2
  exit 1
fi

node - "$TMP_DIR/allow-missing-env-file-report.json" "$ALLOW_MISSING_ENV_FILE" <<'NODE'
const fs = require("node:fs");
const [reportFile, explicitEnvFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
if (report.preflightId !== "external-preflight-env-file") throw new Error("bad env-file preflight id");
if (report.status !== "failed") throw new Error("env-file allow-missing report must preserve failed status");
if (!Array.isArray(report.missing) || report.missing.length <= 0) throw new Error("env-file missing list absent");
if (
  !Array.isArray(report.nextCommands) ||
  !report.nextCommands.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm external:preflight`) ||
  !report.nextCommands.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm completion:gap`) ||
  !report.nextCommands.includes(`ACP_SECRET_ENV_FILE=${explicitEnvFile} pnpm completion:final`) ||
  !report.nextCommands.includes("pnpm smoke:production")
) {
  throw new Error("env-file next command plan did not preserve explicit env file");
}
NODE

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_COMMAND="printf 'ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING=true\\nACP_EXTERNAL_PREFLIGHT_ID=external-preflight-secret-command\\n'" \
  ACP_EXTERNAL_PREFLIGHT_REPORT_FILE="$TMP_DIR/allow-missing-secret-command-report.json" \
  bash scripts/external-smoke-preflight.sh >"$TMP_DIR/allow-missing-secret-command.out"

if ! grep -q "external_smoke_preflight=failed" "$TMP_DIR/allow-missing-secret-command.out"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=allow-missing secret command run did not preserve failed status" >&2
  exit 1
fi

if ! grep -q "^external_preflight_id=external-preflight-secret-command$" "$TMP_DIR/allow-missing-secret-command.out"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=allow-missing secret command run did not honor command preflight id" >&2
  exit 1
fi

node - "$TMP_DIR/allow-missing-secret-command-report.json" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
if (report.preflightId !== "external-preflight-secret-command") throw new Error("bad command preflight id");
if (report.status !== "failed") throw new Error("command allow-missing report must preserve failed status");
if (!Array.isArray(report.missing) || report.missing.length <= 0) throw new Error("command missing list absent");
NODE

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SMOKE_BASE_URL="https://control.acp-smoke.invalid" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_OPERATOR_LOGIN_PASSWORD="operator-login-password-fixture" \
  ACP_OPERATOR_SESSION_SECRET="operator-session-secret-fixture" \
  DATABASE_URL="postgresql://agent:agent@acp-smoke.invalid:5432/acp" \
  PLANE_BASE_URL="https://plane.acp-smoke.invalid" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WRITEBACK_SMOKE_APPLY="true" \
  PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
  OPENHANDS_BASE_URL="https://openhands.acp-smoke.invalid" \
  OPENHANDS_API_KEY="openhands-key-fixture" \
  OPENHANDS_SELECTED_REPOSITORY="acp/smoke-repo" \
  OPENHANDS_SMOKE_CREATE_CONVERSATION="true" \
  OPENHANDS_SMOKE_WAIT_READY="true" \
  OPENHANDS_SMOKE_PAYLOAD_FILE="/secure/raw-openhands-payload.json" \
  OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF="true" \
  LANGFUSE_ENABLED="true" \
  LANGFUSE_BASE_URL="https://langfuse.acp-smoke.invalid" \
  LANGFUSE_PROJECT_ID="project" \
  LANGFUSE_PUBLIC_KEY="langfuse-public-fixture" \
  LANGFUSE_SECRET_KEY="langfuse-secret-fixture" \
  LANGFUSE_SMOKE_DRY_RUN="false" \
  ACP_SECRET_COMMAND="printf 'ACP_PROVIDER_SMOKE=ok\\n'" \
  SECRET_PROVIDER_AUDIT_COMMAND='printf "{}\n"' \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
  ACP_EXTERNAL_PREFLIGHT_REPORT_FILE="$TMP_DIR/ready-report.json" \
  ACP_COMPLETION_FINAL_RUN_ID="external-preflight-smoke" \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-ready" \
  ACP_CUTOVER_REPORT_ID="cutover-report-external-preflight-ready" \
  ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true" \
  ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="true" \
  ACP_CUTOVER_RUN_LANGFUSE_SMOKE="true" \
  ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true" \
  ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="true" \
  ACP_SMOKE_EXTERNAL="true" \
  WORKER_EXECUTION_ADAPTER="openhands-cloud" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="false" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="stopped" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived" \
  bash scripts/external-smoke-preflight.sh >"$READY_OUTPUT"

if ! grep -q "external_smoke_preflight=passed" "$READY_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=complete configuration did not pass" >&2
  exit 1
fi

ready_count="$(awk -F= '$1 == "ready_count" { print $2 }' "$READY_OUTPUT")"
missing_count="$(awk -F= '$1 == "missing_count" { print $2 }' "$READY_OUTPUT")"
if [[ "${ready_count:-}" != "9" || "${missing_count:-}" != "0" ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=unexpected ready/missing counts: ready=${ready_count:-unknown} missing=${missing_count:-unknown}" >&2
  exit 1
fi

if ! grep -q "^external_preflight_id=external-preflight-ready$" "$READY_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=complete configuration did not honor preflight id" >&2
  exit 1
fi

if grep -E -q "(plane-key-fixture|openhands-key-fixture|langfuse-secret-fixture|operator-token-fixture|operator-login-password-fixture|operator-session-secret-fixture|plane-webhook-fixture)" "$READY_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=ready output leaked a secret-shaped fixture" >&2
  exit 1
fi

DEFAULT_TEMPLATE_COMMAND="$DEFAULT_TEMPLATE_COMMAND" node - "$TMP_DIR/ready-report.json" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const raw = fs.readFileSync(reportFile, "utf8");
if (/plane-key-fixture|openhands-key-fixture|langfuse-secret-fixture|operator-token-fixture|operator-login-password-fixture|operator-session-secret-fixture|plane-webhook-fixture/.test(raw)) {
  throw new Error("ready report leaked a secret-shaped fixture");
}
const report = JSON.parse(raw);
const mode = (fs.statSync(reportFile).mode & 0o777).toString(8);
if (mode !== "600") throw new Error(`expected report mode 600, got ${mode}`);
if (report.preflightId !== "external-preflight-ready") throw new Error("bad ready preflight id");
if (report.status !== "passed") throw new Error("ready report must be passed");
if (report.readyCount !== 9 || report.missingCount !== 0) throw new Error("bad ready/missing counts");
if (!Array.isArray(report.ready) || report.ready.length !== 9) throw new Error("ready list absent");
if (!Array.isArray(report.checks) || report.checks.length !== 9) throw new Error("ready checks absent");
if (!report.checks.every((check) => check.status === "ready")) throw new Error("ready checks must all be ready");
if (!Array.isArray(report.scopeSummary) || report.scopeSummary.length !== 9) {
  throw new Error("ready scope summary absent");
}
if (!report.scopeSummary.every((scope) => scope.status === "ready" && scope.ready === 1 && scope.missing === 0)) {
  throw new Error("ready scope summary counts are wrong");
}
if (
  !Array.isArray(report.nextCommands) ||
  !report.nextCommands.includes(process.env.DEFAULT_TEMPLATE_COMMAND) ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm external:preflight") ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:gap") ||
  !report.nextCommands.includes("ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm completion:final")
) {
  throw new Error("next command plan absent");
}
NODE

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SMOKE_BASE_URL="https://control.acp-smoke.invalid" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_OPERATOR_LOGIN_PASSWORD="operator-login-password-fixture" \
  ACP_OPERATOR_SESSION_SECRET="operator-session-secret-fixture" \
  DATABASE_URL="postgresql://agent:agent@acp-smoke.invalid:5432/acp" \
  PLANE_BASE_URL="https://plane.acp-smoke.invalid" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WRITEBACK_SMOKE_APPLY="true" \
  PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
  ACP_SECRET_COMMAND="printf 'ACP_PROVIDER_SMOKE=ok\\n'" \
  SECRET_PROVIDER_AUDIT_COMMAND='printf "{}\n"' \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_CUTOVER_REPORT_FILE="$TMP_DIR/codex-app-server-cutover-report.json" \
  ACP_EXTERNAL_PREFLIGHT_REPORT_FILE="$TMP_DIR/codex-app-server-ready-report.json" \
  ACP_COMPLETION_FINAL_RUN_ID="external-preflight-codex-app-server-smoke" \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-codex-app-server-ready" \
  ACP_CUTOVER_REPORT_ID="cutover-report-external-preflight-codex-app-server-ready" \
  ACP_COMPLETION_EXECUTION_PROFILE="codex-cli" \
  ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true" \
  ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true" \
  ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="true" \
  ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true" \
  ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="true" \
  ACP_SMOKE_EXTERNAL="false" \
  WORKER_EXECUTION_ADAPTER="codex-app-server" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="false" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="stopped" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived" \
  bash scripts/external-smoke-preflight.sh >"$TMP_DIR/codex-app-server-ready.out"

if ! grep -q "external_smoke_preflight=passed" "$TMP_DIR/codex-app-server-ready.out"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=codex-app-server complete configuration did not pass" >&2
  cat "$TMP_DIR/codex-app-server-ready.out" >&2
  exit 1
fi

node - "$TMP_DIR/codex-app-server-ready-report.json" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
if (report.executionProfile !== "codex-cli") throw new Error("bad codex app-server profile");
if (report.readyCount !== 7 || report.missingCount !== 0) {
  throw new Error(`bad codex app-server ready/missing counts: ${report.readyCount}/${report.missingCount}`);
}
if (!report.nextCommands.includes("pnpm codex:app-server-smoke")) {
  throw new Error("codex app-server next command missing");
}
if (report.nextCommands.includes("pnpm codex:adapter-smoke")) {
  throw new Error("codex cli smoke command should not be suggested for app-server adapter");
}
NODE

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SMOKE_BASE_URL="https://control.acp-smoke.invalid" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_OPERATOR_LOGIN_PASSWORD="operator-login-password-fixture" \
  ACP_OPERATOR_SESSION_SECRET="operator-session-secret-fixture" \
  DATABASE_URL="postgresql://agent:agent@acp-smoke.invalid:5432/acp" \
  PLANE_BASE_URL="https://plane.acp-smoke.invalid" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WRITEBACK_SMOKE_APPLY="true" \
  PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
  OPENHANDS_BASE_URL="https://openhands.acp-smoke.invalid" \
  OPENHANDS_API_KEY="openhands-key-fixture" \
  OPENHANDS_SELECTED_REPOSITORY="acp/smoke-repo" \
  OPENHANDS_SMOKE_CREATE_CONVERSATION="true" \
  OPENHANDS_SMOKE_WAIT_READY="true" \
  OPENHANDS_SMOKE_PAYLOAD_FILE="/secure/raw-openhands-payload.json" \
  OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF="true" \
  LANGFUSE_ENABLED="true" \
  LANGFUSE_BASE_URL="https://langfuse.acp-smoke.invalid" \
  LANGFUSE_PROJECT_ID="project" \
  LANGFUSE_PUBLIC_KEY="langfuse-public-fixture" \
  LANGFUSE_SECRET_KEY="langfuse-secret-fixture" \
  LANGFUSE_SMOKE_DRY_RUN="false" \
  ACP_SECRET_COMMAND="printf 'ACP_PROVIDER_SMOKE=ok\\n'" \
  SECRET_PROVIDER_AUDIT_COMMAND='printf "{}\n"' \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-evidence-only-report.json" \
  ACP_EXTERNAL_PREFLIGHT_REPORT_FILE="$TMP_DIR/evidence-only-report.json" \
  ACP_COMPLETION_FINAL_RUN_ID="external-preflight-smoke-evidence-only" \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-evidence-only" \
  ACP_CUTOVER_REPORT_ID="cutover-report-external-preflight-evidence-only" \
  ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true" \
  ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="true" \
  ACP_CUTOVER_RUN_LANGFUSE_SMOKE="true" \
  ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true" \
  ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="true" \
  ACP_SMOKE_EXTERNAL="true" \
  WORKER_EXECUTION_ADAPTER="openhands-cloud" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="false" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="stopped" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived" \
  bash scripts/external-smoke-preflight.sh >"$EVIDENCE_ONLY_OUTPUT" 2>&1
EVIDENCE_ONLY_STATUS=$?
set -e

if [[ "$EVIDENCE_ONLY_STATUS" -eq 0 ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=evidence-only cutover gate unexpectedly passed" >&2
  exit 1
fi

if grep -q "external_smoke_preflight=passed" "$EVIDENCE_ONLY_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=evidence-only cutover gate emitted passed status" >&2
  exit 1
fi

if grep -q "^ready=cutover_gate$" "$EVIDENCE_ONLY_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=evidence-only cutover gate reported ready" >&2
  exit 1
fi

for expected in \
  "ACP_CUTOVER_LEGACY_POLLER_READONLY must be true" \
  "ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED must be true"; do
  if ! grep -q "$expected" "$EVIDENCE_ONLY_OUTPUT"; then
    echo "external_preflight_smoke=failed" >&2
    echo "error=evidence-only cutover gate missed ${expected}" >&2
    exit 1
  fi
done

node - "$TMP_DIR/evidence-only-report.json" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
if (report.status !== "failed") throw new Error("evidence-only report must preserve failed status");
if (report.ready.includes("cutover_gate")) throw new Error("evidence-only cutover gate must not be ready");
if (!report.missing.some((item) => item.includes("ACP_CUTOVER_LEGACY_POLLER_READONLY must be true"))) {
  throw new Error("evidence-only report missed legacy poller readonly boolean");
}
if (!report.missing.some((item) => item.includes("ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED must be true"))) {
  throw new Error("evidence-only report missed Linear archive confirmation boolean");
}
NODE

TEMPLATE_FILE="$TMP_DIR/final-template.env"
ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE="$TEMPLATE_FILE" bash scripts/completion-final-env-template.sh >/dev/null

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$TEMPLATE_FILE" \
  ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING=true \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-template-placeholder" \
  bash scripts/external-smoke-preflight.sh >"$TEMPLATE_PLACEHOLDER_OUTPUT" 2>&1
TEMPLATE_PLACEHOLDER_STATUS=$?
set -e

if [[ "$TEMPLATE_PLACEHOLDER_STATUS" -ne 0 ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=template placeholder allow-missing run unexpectedly failed hard" >&2
  exit 1
fi

if ! grep -q "external_smoke_preflight=failed" "$TEMPLATE_PLACEHOLDER_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=template placeholder run did not preserve failed status" >&2
  exit 1
fi

if ! grep -q "template placeholder" "$TEMPLATE_PLACEHOLDER_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=template placeholder run did not reject unreplaced template values" >&2
  exit 1
fi

UNSAFE_ENV_FILE="$TMP_DIR/unsafe.env"
cat >"$UNSAFE_ENV_FILE" <<EOF
ACP_CUTOVER_REPORT_FILE="\$(touch "$TMP_DIR/unsafe-executed")"
EOF
chmod 600 "$UNSAFE_ENV_FILE"

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SECRET_ENV_FILE="$UNSAFE_ENV_FILE" \
  ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING=true \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-unsafe-env" \
  bash scripts/external-smoke-preflight.sh >"$UNSAFE_ENV_OUTPUT" 2>&1
UNSAFE_ENV_STATUS=$?
set -e

if [[ "$UNSAFE_ENV_STATUS" -ne 0 ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=unsafe env allow-missing run unexpectedly failed hard" >&2
  exit 1
fi

if [[ -e "$TMP_DIR/unsafe-executed" ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=unsafe env command substitution was executed" >&2
  exit 1
fi

if ! grep -q "shell command substitution is not allowed" "$UNSAFE_ENV_OUTPUT"; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=unsafe env command substitution was not rejected" >&2
  exit 1
fi

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SMOKE_BASE_URL="http://127.0.0.1:3112" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_OPERATOR_LOGIN_PASSWORD="operator-login-password-fixture" \
  ACP_OPERATOR_SESSION_SECRET="operator-session-secret-fixture" \
  DATABASE_URL="postgresql://agent:agent@localhost:54329/acp" \
  PLANE_BASE_URL="http://localhost:3200" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WRITEBACK_SMOKE_APPLY="true" \
  PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
  OPENHANDS_BASE_URL="http://0.0.0.0:3000" \
  OPENHANDS_API_KEY="openhands-key-fixture" \
  OPENHANDS_SELECTED_REPOSITORY="acp/smoke-repo" \
  OPENHANDS_SMOKE_CREATE_CONVERSATION="true" \
  OPENHANDS_SMOKE_WAIT_READY="true" \
  OPENHANDS_SMOKE_PAYLOAD_FILE="/secure/raw-openhands-payload.json" \
  OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF="true" \
  LANGFUSE_ENABLED="true" \
  LANGFUSE_BASE_URL="http://[::1]:3001" \
  LANGFUSE_PROJECT_ID="project" \
  LANGFUSE_PUBLIC_KEY="langfuse-public-fixture" \
  LANGFUSE_SECRET_KEY="langfuse-secret-fixture" \
  LANGFUSE_SMOKE_DRY_RUN="false" \
  ACP_SECRET_COMMAND="printf 'ACP_PROVIDER_SMOKE=ok\\n'" \
  SECRET_PROVIDER_AUDIT_COMMAND='printf "{}\n"' \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
  ACP_COMPLETION_FINAL_RUN_ID="external-preflight-smoke" \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-loopback-url" \
  ACP_CUTOVER_REPORT_ID="cutover-report-external-preflight-loopback-url" \
  ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true" \
  ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="true" \
  ACP_CUTOVER_RUN_LANGFUSE_SMOKE="true" \
  ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true" \
  ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="true" \
  ACP_SMOKE_EXTERNAL="true" \
  WORKER_EXECUTION_ADAPTER="openhands-cloud" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="false" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="stopped" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived" \
  bash scripts/external-smoke-preflight.sh >"$LOOPBACK_URL_OUTPUT" 2>&1
LOOPBACK_URL_STATUS=$?
set -e

if [[ "$LOOPBACK_URL_STATUS" -eq 0 ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=loopback URL configuration unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "ACP_SMOKE_BASE_URL must not use loopback URL" \
  "PLANE_BASE_URL must not use loopback URL" \
  "OPENHANDS_BASE_URL must not use loopback URL" \
  "LANGFUSE_BASE_URL must not use loopback URL"; do
  if ! grep -q "$expected" "$LOOPBACK_URL_OUTPUT"; then
    echo "external_preflight_smoke=failed" >&2
    echo "error=loopback URL output missed ${expected}" >&2
    exit 1
  fi
done

set +e
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  ACP_SMOKE_BASE_URL="https://control.acp-smoke.invalid" \
  ACP_OPERATOR_API_TOKEN="operator-token-fixture" \
  ACP_OPERATOR_LOGIN_PASSWORD="operator-login-password-fixture" \
  ACP_OPERATOR_SESSION_SECRET="operator-session-secret-fixture" \
  DATABASE_URL="postgresql://agent:agent@acp-smoke.invalid:5432/acp" \
  PLANE_BASE_URL="https://plane.acp-smoke.invalid" \
  PLANE_WORKSPACE_SLUG="workspace" \
  PLANE_PROJECT_ID="project" \
  PLANE_API_KEY="plane-key-fixture" \
  PLANE_WRITEBACK_SMOKE_APPLY="true" \
  PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="issue-1" \
  OPENHANDS_BASE_URL="https://openhands.acp-smoke.invalid" \
  OPENHANDS_API_KEY="openhands-key-fixture" \
  OPENHANDS_SELECTED_REPOSITORY="acp/smoke-repo" \
  OPENHANDS_SMOKE_CREATE_CONVERSATION="true" \
  OPENHANDS_SMOKE_WAIT_READY="false" \
  OPENHANDS_SMOKE_PAYLOAD_FILE="/secure/raw-openhands-payload.json" \
  OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF="false" \
  LANGFUSE_ENABLED="true" \
  LANGFUSE_BASE_URL="https://langfuse.acp-smoke.invalid" \
  LANGFUSE_PROJECT_ID="project" \
  LANGFUSE_PUBLIC_KEY="langfuse-public-fixture" \
  LANGFUSE_SECRET_KEY="langfuse-secret-fixture" \
  LANGFUSE_SMOKE_DRY_RUN="true" \
  WORKER_CRASH_SMOKE_TEMP_DB="false" \
  WORKER_BUDGET_SMOKE_TEMP_DB="false" \
  WORKER_WORKFLOW_SMOKE_TEMP_DB="false" \
  ACP_SECRET_COMMAND="printf 'ACP_PROVIDER_SMOKE=ok\\n'" \
  SECRET_PROVIDER_AUDIT_COMMAND='printf "{}\n"' \
  PLANE_WEBHOOK_SECRET="plane-webhook-fixture" \
  PLANE_WRITEBACK_ENABLED="true" \
  ACP_CUTOVER_REPORT_FILE="$TMP_DIR/cutover-report.json" \
  ACP_COMPLETION_FINAL_RUN_ID="external-preflight-smoke" \
  ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-bad-real-behavior" \
  ACP_CUTOVER_REPORT_ID="cutover-report-external-preflight-bad-real-behavior" \
  ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true" \
  ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="true" \
  ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="true" \
  ACP_CUTOVER_RUN_LANGFUSE_SMOKE="true" \
  ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true" \
  ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true" \
  ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true" \
  ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="true" \
  ACP_SMOKE_EXTERNAL="true" \
  WORKER_EXECUTION_ADAPTER="openhands-cloud" \
  ACP_CUTOVER_SKIP_SECRET_VALIDATE="false" \
  ACP_CUTOVER_LEGACY_POLLER_READONLY="true" \
  ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="stopped" \
  ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="true" \
  ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived" \
  bash scripts/external-smoke-preflight.sh >"$BAD_REAL_BEHAVIOR_OUTPUT" 2>&1
BAD_REAL_BEHAVIOR_STATUS=$?
set -e

if [[ "$BAD_REAL_BEHAVIOR_STATUS" -eq 0 ]]; then
  echo "external_preflight_smoke=failed" >&2
  echo "error=bad real-behavior configuration unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "OPENHANDS_SMOKE_WAIT_READY must be true" \
  "OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF must be true" \
  "LANGFUSE_SMOKE_DRY_RUN must not be true" \
  "WORKER_CRASH_SMOKE_TEMP_DB must not be false" \
  "WORKER_BUDGET_SMOKE_TEMP_DB must not be false" \
  "WORKER_WORKFLOW_SMOKE_TEMP_DB must not be false"; do
  if ! grep -q "$expected" "$BAD_REAL_BEHAVIOR_OUTPUT"; then
    echo "external_preflight_smoke=failed" >&2
    echo "error=bad real-behavior output missed ${expected}" >&2
    exit 1
  fi
done

echo "external_preflight_smoke=passed"
echo "missing_configuration_rejected=true"
echo "allow_missing_reports_gap=true"
echo "allow_missing_env_file_honored=true"
echo "allow_missing_secret_command_honored=true"
echo "template_placeholders_rejected=true"
echo "unsafe_env_command_substitution_rejected=true"
echo "complete_configuration_accepted=true"
echo "cutover_boolean_confirmations_required=true"
echo "real_behavior_flags_required=true"
echo "loopback_urls_rejected=true"
echo "preflight_id_output_verified=true"
echo "preflight_report_verified=true"
