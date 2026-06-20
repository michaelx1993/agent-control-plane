#!/usr/bin/env bash
set -euo pipefail
umask 077

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-completion-audit.XXXXXX")"
PAYLOAD_CONTRACT_FILE="$TMP_DIR/raw-openhands-payload.json"
BAD_PAYLOAD_CONTRACT_FILE="$TMP_DIR/world-readable-openhands-payload.json"
BAD_PAYLOAD_CONTENT_FILE="$TMP_DIR/invalid-openhands-payload.json"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

INCOMPLETE_REPORT="$TMP_DIR/incomplete-cutover-report.json"
COMPLETE_REPORT="$TMP_DIR/complete-cutover-report.json"
CODEX_COMPLETE_REPORT="$TMP_DIR/codex-complete-cutover-report.json"
CODEX_APP_SERVER_COMPLETE_REPORT="$TMP_DIR/codex-app-server-complete-cutover-report.json"
LEGACY_CODEX_TASK_SOURCE_REPORT="$TMP_DIR/legacy-codex-task-source-cutover-report.json"
WARNING_REPORT="$TMP_DIR/warning-cutover-report.json"
SMOKE_FLAG_REPORT="$TMP_DIR/smoke-flag-cutover-report.json"
GATE_REPORT="$TMP_DIR/gate-cutover-report.json"
CONFIG_REPORT="$TMP_DIR/config-cutover-report.json"
STALE_REPORT="$TMP_DIR/stale-cutover-report.json"
STALE_EVIDENCE_REPORT="$TMP_DIR/stale-evidence-cutover-report.json"
REPORT_ID_REPORT="$TMP_DIR/report-id-cutover-report.json"
REPORT_ID_MISMATCH_REPORT="$TMP_DIR/report-id-mismatch-cutover-report.json"
REPORT_PERMISSIONS_REPORT="$TMP_DIR/report-permissions-cutover-report.json"
FINAL_RUN_ID_REPORT="$TMP_DIR/final-run-id-cutover-report.json"
EXTERNAL_PREFLIGHT_ID_REPORT="$TMP_DIR/external-preflight-id-cutover-report.json"
REHEARSAL_OVERRIDE_REPORT="$TMP_DIR/rehearsal-override-cutover-report.json"
ENV_OVERRIDE_REPORT="$TMP_DIR/env-override-cutover-report.json"
MALFORMED_EVIDENCE_REPORT="$TMP_DIR/malformed-evidence-cutover-report.json"
EXTERNAL_PREFLIGHT_REPORT="$TMP_DIR/external-preflight-cutover-report.json"
TEMPLATE_PLACEHOLDER_REPORT="$TMP_DIR/template-placeholder-cutover-report.json"
PAYLOAD_FILE_REPORT="$TMP_DIR/payload-file-cutover-report.json"
PAYLOAD_CONTENT_REPORT="$TMP_DIR/payload-content-cutover-report.json"
OPENHANDS_CONVERSATION_REPORT="$TMP_DIR/openhands-conversation-cutover-report.json"
OPENHANDS_ADAPTER_REPORT="$TMP_DIR/openhands-adapter-cutover-report.json"
OPENHANDS_DB_REPORT="$TMP_DIR/openhands-db-cutover-report.json"
LANGFUSE_TRACE_REPORT="$TMP_DIR/langfuse-trace-cutover-report.json"
PRODUCTION_SMOKE_REPORT="$TMP_DIR/production-smoke-cutover-report.json"
PLANE_WRITEBACK_REPORT="$TMP_DIR/plane-writeback-cutover-report.json"
INCOMPLETE_OUTPUT="$TMP_DIR/incomplete.out"
COMPLETE_OUTPUT="$TMP_DIR/complete.out"
CODEX_COMPLETE_OUTPUT="$TMP_DIR/codex-complete.out"
CODEX_APP_SERVER_COMPLETE_OUTPUT="$TMP_DIR/codex-app-server-complete.out"
LEGACY_CODEX_TASK_SOURCE_OUTPUT="$TMP_DIR/legacy-codex-task-source.out"
WARNING_OUTPUT="$TMP_DIR/warning.out"
SMOKE_FLAG_OUTPUT="$TMP_DIR/smoke-flag.out"
GATE_OUTPUT="$TMP_DIR/gate.out"
CONFIG_OUTPUT="$TMP_DIR/config.out"
STALE_OUTPUT="$TMP_DIR/stale.out"
STALE_EVIDENCE_OUTPUT="$TMP_DIR/stale-evidence.out"
REPORT_ID_OUTPUT="$TMP_DIR/report-id.out"
REPORT_ID_MISMATCH_OUTPUT="$TMP_DIR/report-id-mismatch.out"
REPORT_PERMISSIONS_OUTPUT="$TMP_DIR/report-permissions.out"
FINAL_RUN_ID_OUTPUT="$TMP_DIR/final-run-id.out"
EXTERNAL_PREFLIGHT_ID_OUTPUT="$TMP_DIR/external-preflight-id.out"
REHEARSAL_OVERRIDE_OUTPUT="$TMP_DIR/rehearsal-override.out"
ENV_OVERRIDE_OUTPUT="$TMP_DIR/env-override.out"
MALFORMED_EVIDENCE_OUTPUT="$TMP_DIR/malformed-evidence.out"
EXTERNAL_PREFLIGHT_OUTPUT="$TMP_DIR/external-preflight.out"
TEMPLATE_PLACEHOLDER_OUTPUT="$TMP_DIR/template-placeholder.out"
PAYLOAD_FILE_OUTPUT="$TMP_DIR/payload-file.out"
PAYLOAD_CONTENT_OUTPUT="$TMP_DIR/payload-content.out"
OPENHANDS_CONVERSATION_OUTPUT="$TMP_DIR/openhands-conversation.out"
OPENHANDS_ADAPTER_OUTPUT="$TMP_DIR/openhands-adapter.out"
OPENHANDS_DB_OUTPUT="$TMP_DIR/openhands-db.out"
LANGFUSE_TRACE_OUTPUT="$TMP_DIR/langfuse-trace.out"
PRODUCTION_SMOKE_OUTPUT="$TMP_DIR/production-smoke.out"
PLANE_WRITEBACK_OUTPUT="$TMP_DIR/plane-writeback.out"

cat >"$PAYLOAD_CONTRACT_FILE" <<'JSON'
{
  "conversation": {
    "id": "conv-smoke",
    "status": "completed",
    "ui_url": "https://openhands.acp-smoke.invalid/conversation/conv-smoke",
    "events": [
      {
        "type": "agent_message",
        "message": "completed"
      },
      {
        "type": "tool_call",
        "tool": "shell",
        "command": "pnpm test"
      }
    ]
  }
}
JSON
chmod 600 "$PAYLOAD_CONTRACT_FILE"
cp "$PAYLOAD_CONTRACT_FILE" "$BAD_PAYLOAD_CONTRACT_FILE"
chmod 644 "$BAD_PAYLOAD_CONTRACT_FILE"
printf '{"conversation":{"id":"conv-smoke"},"events":[]}\n' >"$BAD_PAYLOAD_CONTENT_FILE"
chmod 600 "$BAD_PAYLOAD_CONTENT_FILE"

cat >"$INCOMPLETE_REPORT" <<'JSON'
{
  "readiness": "passed",
  "errors": [],
  "warnings": [],
  "gates": {
    "planeWritebackEnabled": true,
    "legacyPollerReadonly": true,
    "linearArchiveConfirmed": true
  },
  "smoke": {
    "production": true,
    "planeWriteback": true,
    "openhandsConversation": true,
    "openhandsAdapter": true,
    "openhandsDbRun": true,
    "langfuseTrace": true,
    "taskSource": true,
    "workerCrashRecovery": true,
    "workerBudget": true,
    "workerWorkflow": true,
    "secretProvider": true,
    "secretProviderAudit": true,
    "externalPreflight": true
  },
  "evidence": {
    "openhandsConversation": "http://127.0.0.1:3000/conversation/mock",
    "openhandsAdapter": "not-run",
    "openhandsDbRun": "not-run",
    "langfuseTrace": "not-run",
    "planeWriteback": "cutover-rehearsal mock",
    "productionSmoke": "not-run",
    "taskSource": "not-run",
    "secretProvider": "not-run",
    "secretProviderAudit": "matched_events=0",
    "legacyPoller": "cutover-rehearsal mock",
    "linearArchive": "cutover-rehearsal mock",
    "workerCrashRecovery": "stale_run_id=run-1;recovered_run_id=run-2;recovered_attempt=2;next_state=Code Review",
    "workerBudget": "task_id=task-1;estimated_cost_usd=3.5;max_estimated_cost_usd_per_run=1;budget_blocked=true;final_state=Blocked",
    "workerWorkflow": "task_id=task-1;runs=6;final_state=Done",
    "externalPreflight": "preflight_id=preflight-incomplete;ready_count=9;missing_count=0"
  },
  "config": {
    "workerExecutionAdapter": "openhands-cloud",
    "langfuseEnabled": true,
    "cutoverSkipSecretValidate": false,
    "smokeExternal": true
  }
}
JSON

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$INCOMPLETE_REPORT" node scripts/completion-audit.mjs >"$INCOMPLETE_OUTPUT" 2>&1
INCOMPLETE_STATUS=$?
set -e

if [[ "$INCOMPLETE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=incomplete report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_status=incomplete" "$INCOMPLETE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=incomplete report did not emit incomplete status" >&2
  exit 1
fi

cat >"$COMPLETE_REPORT" <<'JSON'
{
  "generatedAt": "1970-01-01T00:00:00.000Z",
  "reportId": "completion-audit-smoke-report",
  "readiness": "passed",
  "errors": [],
  "warnings": [],
  "gates": {
    "planeWritebackEnabled": true,
    "legacyPollerReadonly": true,
    "linearArchiveConfirmed": true
  },
  "smoke": {
    "production": true,
    "planeWriteback": true,
    "openhandsConversation": true,
    "openhandsAdapter": true,
    "openhandsDbRun": true,
    "langfuseTrace": true,
    "taskSource": true,
    "workerCrashRecovery": true,
    "workerBudget": true,
    "workerWorkflow": true,
    "secretProvider": true,
    "secretProviderAudit": true,
    "externalPreflight": true
  },
  "evidence": {
    "openhandsConversation": "ui_url=https://openhands.acp-smoke.invalid/conversation/acp-smoke;conversation_id=conv-smoke;payload_file=/secure/raw-openhands-payload.json",
    "openhandsAdapter": "ui_url=https://openhands.acp-smoke.invalid/conversation/acp-adapter;conversation_id=conv-adapter;next_state=Code Review",
    "openhandsDbRun": "run_id=run-smoke;conversation_id=conv-smoke;ui_url=https://openhands.acp-smoke.invalid/conversation/acp-db-run;prompt_release_id=prompt-smoke;trace_refs=1;trace_ui_url=https://langfuse.acp-smoke.invalid/project/proj/traces/trace-db-run;next_state=Code Review;events=4",
    "langfuseTrace": "trace_id=trace-smoke;ui_url=https://langfuse.acp-smoke.invalid/project/proj/traces/trace-smoke",
    "planeWriteback": "work_item_id=plane-1;state=Human Review;comment=created;verified=true",
    "productionSmoke": "plane=https://plane.acp-smoke.invalid;plane_status=200;openhands=https://openhands.acp-smoke.invalid;openhands_status=200;langfuse=https://langfuse.acp-smoke.invalid;langfuse_status=200",
    "taskSource": "checked=3;plane_urls=3;linear_urls=0;routed=3;runs=3;conversations=3;traces=3",
    "secretProvider": "variables=12;validation=passed",
    "secretProviderAudit": "source=provider-api;events=4;matched_events=2;newest_event_at=2026-06-19T00:00:00.000Z",
    "legacyPoller": "systemctl status symphony-poller: disabled since 2026-06-19T00:00:00Z",
    "linearArchive": "Linear workspace archived read-only on 2026-06-19",
    "workerCrashRecovery": "stale_run_id=run-1;recovered_run_id=run-2;recovered_attempt=2;next_state=Code Review",
    "workerBudget": "task_id=task-1;estimated_cost_usd=3.5;max_estimated_cost_usd_per_run=1;budget_blocked=true;final_state=Blocked",
    "workerWorkflow": "task_id=task-1;runs=6;final_state=Done",
    "externalPreflight": "preflight_id=preflight-complete;ready_count=9;missing_count=0"
  },
  "config": {
    "workerExecutionAdapter": "openhands-cloud",
    "langfuseEnabled": true,
    "cutoverSkipSecretValidate": false,
    "smokeExternal": true
  }
}
JSON

node - "$COMPLETE_REPORT" "$PAYLOAD_CONTRACT_FILE" <<'NODE'
const fs = require("node:fs");
const [file, payloadFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, "utf8"));
const now = new Date().toISOString();
const today = now.slice(0, 10);
report.generatedAt = now;
report.completionFinalRunId = "completion-audit-smoke";
report.evidence.openhandsConversation = `ui_url=https://openhands.acp-smoke.invalid/conversation/acp-smoke;conversation_id=conv-smoke;payload_file=${payloadFile}`;
report.evidence.secretProviderAudit = `source=provider-api;events=4;matched_events=2;newest_event_at=${now}`;
report.evidence.legacyPoller = `systemctl status symphony-poller: disabled since ${now}`;
report.evidence.linearArchive = `Linear workspace archived read-only on ${today}`;
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
NODE

ACP_COMPLETION_AUDIT_REPORT_FILE="$COMPLETE_REPORT" node scripts/completion-audit.mjs >"$COMPLETE_OUTPUT"

if ! grep -q "completion_audit_status=passed" "$COMPLETE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=complete report did not pass" >&2
  exit 1
fi

missing_count="$(awk -F= '$1 == "completion_audit_missing_count" { print $2 }' "$COMPLETE_OUTPUT")"
if [[ "${missing_count:-unknown}" != "0" ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=complete report missing count is ${missing_count:-unknown}" >&2
  exit 1
fi

ACP_COMPLETION_AUDIT_REPORT_FILE="$COMPLETE_REPORT" \
ACP_COMPLETION_FINAL_RUN_ID="completion-audit-smoke" \
ACP_EXTERNAL_PREFLIGHT_ID="preflight-complete" \
  node scripts/completion-audit.mjs >"$TMP_DIR/final-run-id-match.out"

if ! grep -q "completion_audit_status=passed" "$TMP_DIR/final-run-id-match.out"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=matching final run id and external preflight id report did not pass" >&2
  exit 1
fi

ACP_COMPLETION_AUDIT_REPORT_FILE="$COMPLETE_REPORT" \
ACP_CUTOVER_REPORT_ID="completion-audit-smoke-report" \
  node scripts/completion-audit.mjs >"$TMP_DIR/report-id-match.out"

if ! grep -q "completion_audit_status=passed" "$TMP_DIR/report-id-match.out"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=matching cutover report id did not pass" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$CODEX_COMPLETE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.smoke.production = false;
report.smoke.codexAdapter = true;
report.smoke.openhandsConversation = false;
report.smoke.openhandsAdapter = false;
report.smoke.openhandsDbRun = false;
report.smoke.langfuseTrace = false;
report.evidence.codexAdapter =
  "provider=codex-cli;next_state=Code Review;events=4;summary=codex smoke passed";
report.evidence.openhandsConversation = "not-run";
report.evidence.openhandsAdapter = "not-run";
report.evidence.openhandsDbRun = "not-run";
report.evidence.langfuseTrace = "not-run";
report.evidence.productionSmoke = "not-run";
report.evidence.taskSource =
  "checked=3;plane_urls=3;linear_urls=0;routed=3;runs=3;run_events=3;progress_items=3;prompt_releases=3;workspaces=3;conversations=0;traces=0";
report.evidence.externalPreflight = "preflight_id=preflight-codex;ready_count=6;missing_count=0";
report.config.completionExecutionProfile = "codex-cli";
report.config.workerExecutionAdapter = "codex-cli";
report.config.langfuseEnabled = false;
report.config.smokeExternal = false;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

ACP_COMPLETION_AUDIT_REPORT_FILE="$CODEX_COMPLETE_REPORT" node scripts/completion-audit.mjs >"$CODEX_COMPLETE_OUTPUT"

if ! grep -q "completion_audit_status=passed" "$CODEX_COMPLETE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=codex-cli report did not pass with run_events/progress_items/prompt_releases/workspaces task-source evidence" >&2
  cat "$CODEX_COMPLETE_OUTPUT" >&2
  exit 1
fi

node - "$CODEX_COMPLETE_REPORT" "$CODEX_APP_SERVER_COMPLETE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.codexAdapter =
  "provider=codex-app-server;next_state=Code Review;events=5;summary=codex app-server smoke passed";
report.config.workerExecutionAdapter = "codex-app-server";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

ACP_COMPLETION_AUDIT_REPORT_FILE="$CODEX_APP_SERVER_COMPLETE_REPORT" node scripts/completion-audit.mjs >"$CODEX_APP_SERVER_COMPLETE_OUTPUT"

if ! grep -q "completion_audit_status=passed" "$CODEX_APP_SERVER_COMPLETE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=codex-app-server report did not pass with Codex task-source evidence" >&2
  cat "$CODEX_APP_SERVER_COMPLETE_OUTPUT" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$LEGACY_CODEX_TASK_SOURCE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.taskSource =
  "checked=3;plane_urls=3;linear_urls=0;routed=3;runs=3;run_events=3;progress_items=3;prompt_releases=3;workspaces=3;conversations=0;traces=0";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$LEGACY_CODEX_TASK_SOURCE_REPORT" node scripts/completion-audit.mjs >"$LEGACY_CODEX_TASK_SOURCE_OUTPUT" 2>&1
LEGACY_CODEX_TASK_SOURCE_STATUS=$?
set -e

if [[ "$LEGACY_CODEX_TASK_SOURCE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=legacy report unexpectedly accepted codex task-source evidence without conversations/traces" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=task source cutover" "$LEGACY_CODEX_TASK_SOURCE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=legacy report did not fail task-source evidence without conversations/traces" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$PAYLOAD_FILE_REPORT" "$BAD_PAYLOAD_CONTRACT_FILE" <<'NODE'
const fs = require("node:fs");
const [input, output, payloadFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsConversation = `ui_url=https://openhands.acp-smoke.invalid/conversation/acp-smoke;conversation_id=conv-smoke;payload_file=${payloadFile}`;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$PAYLOAD_FILE_REPORT" node scripts/completion-audit.mjs >"$PAYLOAD_FILE_OUTPUT" 2>&1
PAYLOAD_FILE_STATUS=$?
set -e

if [[ "$PAYLOAD_FILE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=world-readable OpenHands payload file unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=OpenHands payload capture" "$PAYLOAD_FILE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=world-readable OpenHands payload file did not fail payload capture" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$PAYLOAD_CONTENT_REPORT" "$BAD_PAYLOAD_CONTENT_FILE" <<'NODE'
const fs = require("node:fs");
const [input, output, payloadFile] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsConversation = `ui_url=https://openhands.acp-smoke.invalid/conversation/acp-smoke;conversation_id=conv-smoke;payload_file=${payloadFile}`;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$PAYLOAD_CONTENT_REPORT" node scripts/completion-audit.mjs >"$PAYLOAD_CONTENT_OUTPUT" 2>&1
PAYLOAD_CONTENT_STATUS=$?
set -e

if [[ "$PAYLOAD_CONTENT_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=invalid OpenHands payload content unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_invalid=OpenHands payload contract" "$PAYLOAD_CONTENT_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=invalid OpenHands payload content did not fail payload contract" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$OPENHANDS_CONVERSATION_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsConversation =
  "https://openhands.acp-smoke.invalid/conversation/acp-smoke;payload_file=/secure/raw-openhands-payload.json";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$OPENHANDS_CONVERSATION_REPORT" node scripts/completion-audit.mjs >"$OPENHANDS_CONVERSATION_OUTPUT" 2>&1
OPENHANDS_CONVERSATION_STATUS=$?
set -e

if [[ "$OPENHANDS_CONVERSATION_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=OpenHands conversation without structured ui_url/conversation_id unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=real OpenHands conversation" "$OPENHANDS_CONVERSATION_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=OpenHands conversation without structured fields did not fail conversation evidence" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$OPENHANDS_ADAPTER_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsAdapter =
  "https://openhands.acp-smoke.invalid/conversation/acp-adapter;next_state=Code Review";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$OPENHANDS_ADAPTER_REPORT" node scripts/completion-audit.mjs >"$OPENHANDS_ADAPTER_OUTPUT" 2>&1
OPENHANDS_ADAPTER_STATUS=$?
set -e

if [[ "$OPENHANDS_ADAPTER_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=OpenHands adapter without structured ui_url/conversation_id unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=OpenHands adapter smoke" "$OPENHANDS_ADAPTER_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=OpenHands adapter without structured fields did not fail adapter evidence" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$LANGFUSE_TRACE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.langfuseTrace = "https://langfuse.acp-smoke.invalid/project/proj/traces/trace-smoke";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$LANGFUSE_TRACE_REPORT" node scripts/completion-audit.mjs >"$LANGFUSE_TRACE_OUTPUT" 2>&1
LANGFUSE_TRACE_STATUS=$?
set -e

if [[ "$LANGFUSE_TRACE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=Langfuse trace without trace_id unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=real Langfuse trace" "$LANGFUSE_TRACE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=Langfuse trace without trace_id did not fail trace evidence" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$PRODUCTION_SMOKE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.productionSmoke =
  "plane=https://plane.acp-smoke.invalid;openhands=https://openhands.acp-smoke.invalid;langfuse=https://langfuse.acp-smoke.invalid";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$PRODUCTION_SMOKE_REPORT" node scripts/completion-audit.mjs >"$PRODUCTION_SMOKE_OUTPUT" 2>&1
PRODUCTION_SMOKE_STATUS=$?
set -e

if [[ "$PRODUCTION_SMOKE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=production smoke without status evidence unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=production smoke" "$PRODUCTION_SMOKE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=production smoke without status evidence did not fail production evidence" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$PLANE_WRITEBACK_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.planeWriteback = "work_item_id=plane-1;state=Human Review;verified=true";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$PLANE_WRITEBACK_REPORT" node scripts/completion-audit.mjs >"$PLANE_WRITEBACK_OUTPUT" 2>&1
PLANE_WRITEBACK_STATUS=$?
set -e

if [[ "$PLANE_WRITEBACK_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=Plane writeback without comment unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=Plane writeback" "$PLANE_WRITEBACK_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=Plane writeback without comment did not fail writeback evidence" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$EXTERNAL_PREFLIGHT_ID_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.externalPreflight = "preflight_id=stale-preflight;ready_count=9;missing_count=0";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$EXTERNAL_PREFLIGHT_ID_REPORT" \
ACP_EXTERNAL_PREFLIGHT_ID="current-preflight" \
  node scripts/completion-audit.mjs >"$EXTERNAL_PREFLIGHT_ID_OUTPUT" 2>&1
EXTERNAL_PREFLIGHT_ID_STATUS=$?
set -e

if [[ "$EXTERNAL_PREFLIGHT_ID_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=external preflight id mismatch report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=external preflight" "$EXTERNAL_PREFLIGHT_ID_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=external preflight id mismatch did not fail on external preflight" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$REPORT_ID_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
delete report.reportId;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$REPORT_ID_REPORT" node scripts/completion-audit.mjs >"$REPORT_ID_OUTPUT" 2>&1
REPORT_ID_STATUS=$?
set -e

if [[ "$REPORT_ID_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=missing report id unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=cutover report id" "$REPORT_ID_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=missing report id did not fail on cutover report id" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$REPORT_ID_MISMATCH_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.reportId = "stale-cutover-report-id";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$REPORT_ID_MISMATCH_REPORT" \
ACP_CUTOVER_REPORT_ID="current-cutover-report-id" \
  node scripts/completion-audit.mjs >"$REPORT_ID_MISMATCH_OUTPUT" 2>&1
REPORT_ID_MISMATCH_STATUS=$?
set -e

if [[ "$REPORT_ID_MISMATCH_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=report id mismatch report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=cutover report id" "$REPORT_ID_MISMATCH_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=report id mismatch did not fail on cutover report id" >&2
  exit 1
fi

cp "$COMPLETE_REPORT" "$REPORT_PERMISSIONS_REPORT"
chmod 644 "$REPORT_PERMISSIONS_REPORT"

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$REPORT_PERMISSIONS_REPORT" node scripts/completion-audit.mjs >"$REPORT_PERMISSIONS_OUTPUT" 2>&1
REPORT_PERMISSIONS_STATUS=$?
set -e

if [[ "$REPORT_PERMISSIONS_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=permissive report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=cutover report permissions" "$REPORT_PERMISSIONS_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=permissive report did not fail on cutover report permissions" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$FINAL_RUN_ID_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.completionFinalRunId = "stale-final-run";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$FINAL_RUN_ID_REPORT" \
ACP_COMPLETION_FINAL_RUN_ID="current-final-run" \
  node scripts/completion-audit.mjs >"$FINAL_RUN_ID_OUTPUT" 2>&1
FINAL_RUN_ID_STATUS=$?
set -e

if [[ "$FINAL_RUN_ID_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=final run id mismatch report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=completion final run id" "$FINAL_RUN_ID_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=final run id mismatch did not fail on completion final run id" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$WARNING_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.warnings = ["WORKER_EXECUTION_ADAPTER is not openhands-cloud"];
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$WARNING_REPORT" node scripts/completion-audit.mjs >"$WARNING_OUTPUT" 2>&1
WARNING_STATUS=$?
set -e

if [[ "$WARNING_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=warning report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=cutover report warnings" "$WARNING_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=warning report did not fail on cutover report warnings" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$SMOKE_FLAG_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.smoke.openhandsDbRun = false;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$SMOKE_FLAG_REPORT" node scripts/completion-audit.mjs >"$SMOKE_FLAG_OUTPUT" 2>&1
SMOKE_FLAG_STATUS=$?
set -e

if [[ "$SMOKE_FLAG_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=missing smoke flag report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=OpenHands DB run smoke flag" "$SMOKE_FLAG_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=missing smoke flag report did not fail on OpenHands DB run smoke flag" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$GATE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.gates.planeWritebackEnabled = false;
report.gates.legacyPollerReadonly = false;
report.gates.linearArchiveConfirmed = false;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$GATE_REPORT" node scripts/completion-audit.mjs >"$GATE_OUTPUT" 2>&1
GATE_STATUS=$?
set -e

if [[ "$GATE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=bad gate report unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "completion_audit_missing=Plane writeback enabled gate" \
  "completion_audit_missing=legacy poller readonly gate" \
  "completion_audit_missing=Linear archive confirmed gate"; do
  if ! grep -q "$expected" "$GATE_OUTPUT"; then
    echo "completion_audit_smoke=failed" >&2
    echo "error=bad gate report did not fail on ${expected#completion_audit_missing=}" >&2
    exit 1
  fi
done

node - "$COMPLETE_REPORT" "$CONFIG_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.config.workerExecutionAdapter = "mock-openhands";
report.config.langfuseEnabled = false;
report.config.cutoverSkipSecretValidate = true;
report.config.smokeExternal = false;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$CONFIG_REPORT" node scripts/completion-audit.mjs >"$CONFIG_OUTPUT" 2>&1
CONFIG_STATUS=$?
set -e

if [[ "$CONFIG_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=bad config report unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "completion_audit_missing=worker execution adapter" \
  "completion_audit_missing=Langfuse enabled" \
  "completion_audit_missing=secret validation not skipped" \
  "completion_audit_missing=external production probes"; do
  if ! grep -q "$expected" "$CONFIG_OUTPUT"; then
    echo "completion_audit_smoke=failed" >&2
    echo "error=bad config report did not fail on ${expected#completion_audit_missing=}" >&2
    exit 1
  fi
done

node - "$COMPLETE_REPORT" "$STALE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.generatedAt = "1970-01-01T00:00:00.000Z";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$STALE_REPORT" node scripts/completion-audit.mjs >"$STALE_OUTPUT" 2>&1
STALE_STATUS=$?
set -e

if [[ "$STALE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=stale report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=cutover report freshness" "$STALE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=stale report did not fail on cutover report freshness" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$STALE_EVIDENCE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.generatedAt = new Date().toISOString();
report.evidence.secretProviderAudit =
  "source=provider-api;events=4;matched_events=2;newest_event_at=1970-01-01T00:00:00.000Z";
report.evidence.legacyPoller = "systemctl status symphony-poller: disabled since 1970-01-01T00:00:00Z";
report.evidence.linearArchive = "Linear workspace archived read-only on 1970-01-01";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$STALE_EVIDENCE_REPORT" node scripts/completion-audit.mjs >"$STALE_EVIDENCE_OUTPUT" 2>&1
STALE_EVIDENCE_STATUS=$?
set -e

if [[ "$STALE_EVIDENCE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=stale evidence report unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "completion_audit_missing=secret provider audit" \
  "completion_audit_missing=legacy poller frozen" \
  "completion_audit_missing=Linear archive-only"; do
  if ! grep -q "$expected" "$STALE_EVIDENCE_OUTPUT"; then
    echo "completion_audit_smoke=failed" >&2
    echo "error=stale evidence report did not fail on ${expected#completion_audit_missing=}" >&2
    exit 1
  fi
done

node - "$COMPLETE_REPORT" "$REHEARSAL_OVERRIDE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.manualSummary = "cutover-rehearsal mock evidence";
report.evidence.legacyPoller = "cutover-rehearsal mock: legacy poller disabled";
report.evidence.taskSource = "cutover-rehearsal mock: task source audit passed";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$REHEARSAL_OVERRIDE_REPORT" \
ACP_CUTOVER_OPENHANDS_CONVERSATION_URL="https://openhands.acp-smoke.invalid/conversation/env-override" \
ACP_CUTOVER_LANGFUSE_TRACE_URL="https://langfuse.acp-smoke.invalid/project/proj/traces/env-override" \
ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE="work_item_id=plane-env;state=Done;verified=true" \
ACP_CUTOVER_TASK_SOURCE_EVIDENCE="checked=1;plane_urls=1;linear_urls=0;routed=1;runs=1;conversations=1;traces=1" \
ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="systemctl status symphony-poller: disabled" \
ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="Linear archive-only confirmed" \
  node scripts/completion-audit.mjs >"$REHEARSAL_OVERRIDE_OUTPUT" 2>&1
REHEARSAL_OVERRIDE_STATUS=$?
set -e

if [[ "$REHEARSAL_OVERRIDE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=rehearsal override report unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_status=incomplete" "$REHEARSAL_OVERRIDE_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=rehearsal override report did not emit incomplete status" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$ENV_OVERRIDE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsConversation = "not-run";
report.evidence.langfuseTrace = "not-run";
report.evidence.planeWriteback = "recorded";
report.evidence.taskSource = "recorded";
report.evidence.legacyPoller = "recorded";
report.evidence.linearArchive = "recorded";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$ENV_OVERRIDE_REPORT" \
ACP_CUTOVER_OPENHANDS_CONVERSATION_URL="https://openhands.acp-smoke.invalid/conversation/env-override" \
ACP_CUTOVER_LANGFUSE_TRACE_URL="https://langfuse.acp-smoke.invalid/project/proj/traces/env-override" \
ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE="work_item_id=plane-env;state=Done;verified=true" \
ACP_CUTOVER_TASK_SOURCE_EVIDENCE="checked=1;plane_urls=1;linear_urls=0;routed=1;runs=1;conversations=1;traces=1" \
ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="systemctl status symphony-poller: disabled" \
ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="Linear archive-only confirmed" \
  node scripts/completion-audit.mjs >"$ENV_OVERRIDE_OUTPUT" 2>&1
ENV_OVERRIDE_STATUS=$?
set -e

if [[ "$ENV_OVERRIDE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=env override report unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "completion_audit_missing=real OpenHands conversation" \
  "completion_audit_missing=OpenHands payload capture" \
  "completion_audit_missing=real Langfuse trace" \
  "completion_audit_missing=Plane writeback" \
  "completion_audit_missing=task source cutover" \
  "completion_audit_missing=legacy poller frozen" \
  "completion_audit_missing=Linear archive-only"; do
  if ! grep -q "$expected" "$ENV_OVERRIDE_OUTPUT"; then
    echo "completion_audit_smoke=failed" >&2
    echo "error=env override report did not fail on ${expected#completion_audit_missing=}" >&2
    exit 1
  fi
done

node - "$COMPLETE_REPORT" "$TEMPLATE_PLACEHOLDER_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsConversation =
  "ui_url=https://openhands.example.com/conversation/template;conversation_id=<conversation-id>";
report.evidence.openhandsAdapter =
  "ui_url=https://openhands.example.com/conversation/template-adapter;conversation_id=<conversation-id>;next_state=Code Review";
report.evidence.openhandsDbRun =
  "run_id=<run-id>;conversation_id=<conversation-id>;ui_url=https://openhands.example.com/conversation/template-db;prompt_release_id=<prompt-release-id>;trace_refs=1;trace_ui_url=https://langfuse.example.com/project/proj/traces/template-db;next_state=Code Review;events=4";
report.evidence.langfuseTrace =
  "trace_id=<trace-id>;ui_url=https://langfuse.example.com/project/proj/traces/template";
report.evidence.planeWriteback = "work_item_id=<plane-work-item-id>;state=Human Review;verified=true";
report.evidence.productionSmoke =
  "plane=https://plane.example.com;plane_status=200;openhands=https://openhands.example.com;openhands_status=200;langfuse=https://langfuse.example.com;langfuse_status=200";
report.evidence.taskSource =
  "checked=3;plane_urls=3;linear_urls=0;routed=3;runs=3;conversations=3;traces=3;sample=<task-id>";
report.evidence.secretProvider = "variables=12;validation=passed;source=<provider>";
report.evidence.secretProviderAudit =
  "source=<provider-api>;events=4;matched_events=2;newest_event_at=2026-06-19T00:00:00.000Z";
report.evidence.legacyPoller = "systemctl status symphony-poller: disabled since <YYYY-MM-DD>";
report.evidence.linearArchive = "Linear workspace archived read-only on <YYYY-MM-DD>";
report.evidence.workerCrashRecovery =
  "stale_run_id=<stale-run>;recovered_run_id=<recovered-run>;recovered_attempt=2;next_state=Code Review";
report.evidence.workerBudget =
  "task_id=<task-id>;estimated_cost_usd=3.5;max_estimated_cost_usd_per_run=1;budget_blocked=true;final_state=Blocked";
report.evidence.workerWorkflow = "task_id=<task-id>;runs=6;final_state=Done";
report.evidence.externalPreflight = "preflight_id=<preflight-id>;ready_count=9;missing_count=0";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$TEMPLATE_PLACEHOLDER_REPORT" node scripts/completion-audit.mjs >"$TEMPLATE_PLACEHOLDER_OUTPUT" 2>&1
TEMPLATE_PLACEHOLDER_STATUS=$?
set -e

if [[ "$TEMPLATE_PLACEHOLDER_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=template placeholder evidence report unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "completion_audit_missing=real OpenHands conversation" \
  "completion_audit_missing=OpenHands payload capture" \
  "completion_audit_missing=real Langfuse trace" \
  "completion_audit_missing=OpenHands adapter smoke" \
  "completion_audit_missing=OpenHands DB run smoke" \
  "completion_audit_missing=Plane writeback" \
  "completion_audit_missing=production smoke" \
  "completion_audit_missing=task source cutover" \
  "completion_audit_missing=secret provider smoke" \
  "completion_audit_missing=secret provider audit" \
  "completion_audit_missing=legacy poller frozen" \
  "completion_audit_missing=Linear archive-only" \
  "completion_audit_missing=worker crash recovery" \
  "completion_audit_missing=worker budget gate" \
  "completion_audit_missing=worker workflow" \
  "completion_audit_missing=external preflight"; do
  if ! grep -q "$expected" "$TEMPLATE_PLACEHOLDER_OUTPUT"; then
    echo "completion_audit_smoke=failed" >&2
    echo "error=template placeholder report did not fail on ${expected#completion_audit_missing=}" >&2
    exit 1
  fi
done

node - "$COMPLETE_REPORT" "$OPENHANDS_DB_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsDbRun =
  "run_id=run-smoke;conversation_id=conv-smoke;ui_url=https://openhands.acp-smoke.invalid/conversation/acp-db-run;trace_refs=0;trace_ui_url=https://langfuse.acp-smoke.invalid/project/proj/traces/trace-db-run;next_state=Code Review;events=4";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$OPENHANDS_DB_REPORT" node scripts/completion-audit.mjs >"$OPENHANDS_DB_OUTPUT" 2>&1
OPENHANDS_DB_STATUS=$?
set -e

if [[ "$OPENHANDS_DB_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=OpenHands DB report without prompt release and trace refs unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "completion_audit_missing=OpenHands DB run smoke" "$OPENHANDS_DB_OUTPUT"; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=OpenHands DB report did not fail on DB run smoke evidence" >&2
  exit 1
fi

node - "$COMPLETE_REPORT" "$MALFORMED_EVIDENCE_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.evidence.openhandsDbRun = "run_id=run-smoke;conversation_id=conv-smoke;next_state=Code Review;events=0";
report.evidence.openhandsAdapter = "conversation_id=conv-adapter;next_state=Code Review";
report.evidence.planeWriteback = "work_item_id=plane-1;state=Human Review;verified=false";
report.evidence.productionSmoke = "passed";
report.evidence.openhandsConversation = "ui_url=https://127.1/conversation/local-loopback;conversation_id=conv-local";
report.evidence.langfuseTrace = "trace_id=trace-local;ui_url=https://[::1]/project/proj/traces/local-loopback";
report.evidence.taskSource = "checked=3;plane_urls=2;linear_urls=0;routed=2;runs=1;conversations=2;traces=1";
report.evidence.secretProvider = "variables=0;validation=failed";
report.evidence.secretProviderAudit = "source=unknown;events=0;matched_events=1;newest_event_at=unknown";
report.evidence.legacyPoller = "legacy poller evidence recorded";
report.evidence.linearArchive = "Linear archive evidence recorded";
report.evidence.workerCrashRecovery = "stale_run_id=run-1;recovered_run_id=run-2;recovered_attempt=1;next_state=unknown";
report.evidence.workerBudget = "task_id=task-1;estimated_cost_usd=0;max_estimated_cost_usd_per_run=0;budget_blocked=false;final_state=Development";
report.evidence.workerWorkflow = "task_id=task-1;runs=0;final_state=Human Review";
report.evidence.externalPreflight = "ready_count=7;missing_count=1";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$MALFORMED_EVIDENCE_REPORT" node scripts/completion-audit.mjs >"$MALFORMED_EVIDENCE_OUTPUT" 2>&1
MALFORMED_EVIDENCE_STATUS=$?
set -e

if [[ "$MALFORMED_EVIDENCE_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=malformed evidence report unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "completion_audit_missing=real OpenHands conversation" \
  "completion_audit_missing=OpenHands payload capture" \
  "completion_audit_missing=real Langfuse trace" \
  "completion_audit_missing=OpenHands adapter smoke" \
  "completion_audit_missing=OpenHands DB run smoke" \
  "completion_audit_missing=Plane writeback" \
  "completion_audit_missing=production smoke" \
  "completion_audit_missing=task source cutover" \
  "completion_audit_missing=secret provider smoke" \
  "completion_audit_missing=secret provider audit" \
  "completion_audit_missing=legacy poller frozen" \
  "completion_audit_missing=Linear archive-only" \
  "completion_audit_missing=worker crash recovery" \
  "completion_audit_missing=worker budget gate" \
  "completion_audit_missing=worker workflow" \
  "completion_audit_missing=external preflight"; do
  if ! grep -q "$expected" "$MALFORMED_EVIDENCE_OUTPUT"; then
    echo "completion_audit_smoke=failed" >&2
    echo "error=malformed evidence report did not fail on ${expected#completion_audit_missing=}" >&2
    exit 1
  fi
done

node - "$COMPLETE_REPORT" "$EXTERNAL_PREFLIGHT_REPORT" <<'NODE'
const fs = require("node:fs");
const [input, output] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
report.smoke.externalPreflight = false;
delete report.evidence.externalPreflight;
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
NODE

set +e
ACP_COMPLETION_AUDIT_REPORT_FILE="$EXTERNAL_PREFLIGHT_REPORT" node scripts/completion-audit.mjs >"$EXTERNAL_PREFLIGHT_OUTPUT" 2>&1
EXTERNAL_PREFLIGHT_STATUS=$?
set -e

if [[ "$EXTERNAL_PREFLIGHT_STATUS" -eq 0 ]]; then
  echo "completion_audit_smoke=failed" >&2
  echo "error=missing external preflight report unexpectedly passed" >&2
  exit 1
fi

for expected in \
  "completion_audit_missing=external preflight smoke flag" \
  "completion_audit_missing=external preflight"; do
  if ! grep -q "$expected" "$EXTERNAL_PREFLIGHT_OUTPUT"; then
    echo "completion_audit_smoke=failed" >&2
    echo "error=missing external preflight report did not fail on ${expected#completion_audit_missing=}" >&2
    exit 1
  fi
done

echo "completion_audit_smoke=passed"
echo "incomplete_report_rejected=true"
echo "warning_report_rejected=true"
echo "bad_gate_report_rejected=true"
echo "missing_smoke_flag_rejected=true"
echo "bad_config_report_rejected=true"
echo "stale_report_rejected=true"
echo "stale_evidence_rejected=true"
echo "missing_report_id_rejected=true"
echo "report_id_mismatch_rejected=true"
echo "permissive_report_rejected=true"
echo "final_run_id_mismatch_rejected=true"
echo "external_preflight_id_mismatch_rejected=true"
echo "payload_file_permissions_rejected=true"
echo "payload_file_contract_rejected=true"
echo "openhands_conversation_structured_required=true"
echo "openhands_adapter_structured_required=true"
echo "openhands_db_prompt_release_required=true"
echo "langfuse_trace_id_required=true"
echo "production_smoke_status_required=true"
echo "plane_writeback_comment_required=true"
echo "rehearsal_env_override_rejected=true"
echo "env_override_rejected=true"
echo "template_placeholder_evidence_rejected=true"
echo "malformed_evidence_rejected=true"
echo "missing_external_preflight_rejected=true"
echo "complete_report_accepted=true"
