#!/usr/bin/env bash
set -euo pipefail

OUTPUT_FILE="${ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE:-}"
FORCE="${ACP_COMPLETION_FINAL_ENV_TEMPLATE_FORCE:-false}"
APPEND_MISSING="${ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING:-false}"

write_template() {
  cat <<'EOF'
# Agent Control Plane final cutover environment template.
# Fill every placeholder before running:
#   ACP_SECRET_ENV_FILE=<this-file> pnpm external:preflight
#   ACP_SECRET_ENV_FILE=<this-file> pnpm completion:final

DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane"
ACP_ENV="production"
SECRET_VALIDATION_STRICT="true"

# Operator / Control Plane.
# Final cutover strict secret validation requires all three values below.
ACP_SMOKE_BASE_URL="https://control-plane.example.com"
ACP_OPERATOR_API_TOKEN="<operator-token>"
ACP_OPERATOR_LOGIN_PASSWORD="<operator-login-password>"
ACP_OPERATOR_SESSION_SECRET="<operator-session-secret>"

# Plane.
PLANE_BASE_URL="https://plane.example.com"
PLANE_WORKSPACE_SLUG="<workspace-slug>"
PLANE_PROJECT_ID="<project-id>"
PLANE_PROJECT_SLUG="<project-slug>"
PLANE_API_KEY="<plane-api-key>"
PLANE_WEBHOOK_SECRET="<plane-webhook-secret>"
PLANE_WRITEBACK_ENABLED="true"
PLANE_WRITEBACK_SMOKE_APPLY="true"
PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="<plane-test-work-item-id>"
PLANE_WRITEBACK_SMOKE_NEXT_STATE="Development"
PLANE_WRITEBACK_SMOKE_STATUS="Final Cutover Smoke"
PLANE_WRITEBACK_SMOKE_SUMMARY="Agent Control Plane final cutover Plane writeback smoke."

# Execution profile.
ACP_COMPLETION_EXECUTION_PROFILE="codex-cli"
# Default remains codex-cli. Set WORKER_EXECUTION_ADAPTER="codex-app-server" to use the Symphony-style app-server adapter.
WORKER_EXECUTION_ADAPTER="codex-cli"
WORKER_CODEX_MODEL="gpt-5.5"
WORKER_CODEX_REASONING_EFFORT="high"

# Optional legacy OpenHands/Langfuse profile.
# Set ACP_COMPLETION_EXECUTION_PROFILE="openhands-langfuse" or "external" only when deliberately using this paid external profile.
# WORKER_EXECUTION_ADAPTER="openhands-cloud"
# OPENHANDS_BASE_URL="https://openhands.example.com"
# OPENHANDS_API_KEY="<openhands-api-key>"
# OPENHANDS_SELECTED_REPOSITORY="owner/repo"
# OPENHANDS_SMOKE_CREATE_CONVERSATION="true"
# OPENHANDS_SMOKE_WAIT_READY="true"
# OPENHANDS_SMOKE_POLL_ATTEMPTS="24"
# OPENHANDS_SMOKE_POLL_INTERVAL_SECONDS="5"
# OPENHANDS_SMOKE_PAYLOAD_FILE="/secure/raw-openhands-payload.json"
# OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF="true"
# LANGFUSE_ENABLED="true"
# LANGFUSE_BASE_URL="https://cloud.langfuse.com"
# LANGFUSE_PROJECT_ID="<langfuse-project-id>"
# LANGFUSE_PUBLIC_KEY="<langfuse-public-key>"
# LANGFUSE_SECRET_KEY="<langfuse-secret-key>"
# LANGFUSE_SMOKE_DRY_RUN="false"

# Secret provider.
# Prefer a real provider command here, for example:
# ACP_SECRET_COMMAND='sops -d .secrets/agent-control-plane.env'
ACP_SECRET_COMMAND="<command-that-prints-dotenv>"
# Provide exactly one provider audit source.
SECRET_PROVIDER_AUDIT_FILE=""
SECRET_PROVIDER_AUDIT_COMMAND="<command-that-prints-provider-audit-jsonl>"
SECRET_PROVIDER_AUDIT_EVENT_PATTERN="rotat|secret_rotation"

# Task source audit.
TASK_SOURCE_SMOKE_PROJECT_SLUG="<project-slug>"
TASK_SOURCE_SMOKE_REQUIRE_SAMPLE="true"
TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE="true"
TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE="true"
TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE="false"

# Final cutover report binding.
# Usually leave these commented so completion:final can generate and bind one fresh run id.
# Set them only when binding to an existing external change ticket.
# ACP_COMPLETION_FINAL_RUN_ID="final-YYYYMMDDTHHMMSSZ-change-id"
# ACP_EXTERNAL_PREFLIGHT_ID="external-preflight-final-YYYYMMDDTHHMMSSZ-change-id"
# ACP_CUTOVER_REPORT_ID="cutover-report-change-id"
# ACP_CUTOVER_REPORT_FILE="reports/cutover-final-run-id.json"
# Leave unset unless manually running completion:audit against an existing report.
# ACP_COMPLETION_AUDIT_REPORT_FILE="reports/cutover-final-run-id.json"

# Final gate switches for the default codex-cli profile.
ACP_SMOKE_EXTERNAL="false"
ACP_SMOKE_ENABLE_USER_WRITE="false"
ACP_SMOKE_SKIP_SECRET_VALIDATE="false"
ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING="false"
ACP_CUTOVER_SKIP_SECRET_VALIDATE="false"
ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE="false"
ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE="false"
ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true"
ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE="true"
ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="true"
ACP_CUTOVER_RUN_OPENHANDS_SMOKE="false"
ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="false"
ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="false"
ACP_CUTOVER_RUN_LANGFUSE_SMOKE="false"
ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE="true"
ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE="true"
ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE="true"
ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE="true"
ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE="true"
ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE="true"
ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT="true"

# Legacy/external paid profile override checklist:
# ACP_SMOKE_EXTERNAL="true"
# ACP_CUTOVER_RUN_PRODUCTION_SMOKE="true"
# ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE="false"
# ACP_CUTOVER_RUN_OPENHANDS_SMOKE="true"
# ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE="true"
# ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE="true"
# ACP_CUTOVER_RUN_LANGFUSE_SMOKE="true"

# Local worker smoke isolation. Do not set these to false for final completion.
WORKER_CRASH_SMOKE_TEMP_DB="true"
WORKER_BUDGET_SMOKE_TEMP_DB="true"
WORKER_WORKFLOW_SMOKE_TEMP_DB="true"

# Manual evidence still required by completion audit.
ACP_CUTOVER_LEGACY_POLLER_READONLY="false"
ACP_CUTOVER_LEGACY_POLLER_EVIDENCE="stopped old Linear/Symphony poller on YYYY-MM-DD"
ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED="false"
ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE="archived Linear workspace read-only on YYYY-MM-DD"
ACP_CUTOVER_MANUAL_EVIDENCE_SUMMARY="Final cutover evidence bundle: <change-ticket-or-runbook-url>"
EOF
}

append_missing_template_values() {
  local output_file="$1"
  local template_file
  local missing_file
  template_file="$(mktemp "${TMPDIR:-/tmp}/acp-final-env-template.XXXXXX")"
  missing_file="$(mktemp "${TMPDIR:-/tmp}/acp-final-env-missing.XXXXXX")"
  cleanup_append() {
    rm -f "$template_file" "$missing_file"
  }
  trap cleanup_append RETURN

  write_template >"$template_file"
  awk -F= '
    FNR == NR {
      if ($0 ~ /^[A-Z][A-Z0-9_]*=/) {
        existing[$1] = 1
      }
      next
    }
    $0 ~ /^[A-Z][A-Z0-9_]*=/ {
      if (!existing[$1]) {
        print
      }
    }
  ' "$output_file" "$template_file" >"$missing_file"

  local missing_count
  missing_count="$(grep -c '^[A-Z][A-Z0-9_]*=' "$missing_file" || true)"
  if [[ "$missing_count" -gt 0 ]]; then
    {
      printf '\n# Added by completion:final-env-template append-missing on %s.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      cat "$missing_file"
    } >>"$output_file"
  fi
  chmod 600 "$output_file"

  cat <<EOF
completion_final_env_template=appended_missing
completion_final_env_template_file=${output_file}
completion_final_env_template_missing_count=${missing_count}
completion_final_env_template_missing_variables=$(awk -F= '$0 ~ /^[A-Z][A-Z0-9_]*=/ { names = names ? names "," $1 : $1 } END { print names }' "$missing_file")
EOF
}

if [[ -z "$OUTPUT_FILE" ]]; then
  write_template
  exit 0
fi

if [[ -e "$OUTPUT_FILE" && "$FORCE" != "true" ]]; then
  if [[ "$APPEND_MISSING" == "true" ]]; then
    append_missing_template_values "$OUTPUT_FILE"
    exit 0
  fi
  echo "completion_final_env_template=failed" >&2
  echo "error=output file already exists; set ACP_COMPLETION_FINAL_ENV_TEMPLATE_FORCE=true to overwrite or ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true to append missing template variables" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"
tmp_file="$(mktemp "${TMPDIR:-/tmp}/acp-final-env-template.XXXXXX")"
write_template >"$tmp_file"
chmod 600 "$tmp_file"
mv "$tmp_file" "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"

cat <<EOF
completion_final_env_template=written
completion_final_env_template_file=${OUTPUT_FILE}
EOF
