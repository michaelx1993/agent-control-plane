#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/web-build-retry.sh
source "$SCRIPT_DIR/lib/web-build-retry.sh"

run_step() {
  local name="$1"
  shift
  echo "local_completion_step=${name}"
  "$@"
}

next_lock_holders() {
  local lock_file="apps/web/.next/dev/lock"
  if [[ ! -e "$lock_file" ]]; then
    return
  fi

  lsof "$lock_file" 2>/dev/null | awk 'NR > 1 { print $2 ":" $1 }' | sort -u
}

run_step "git_diff_check" git diff --check
run_step "script_syntax_check" bash -c \
  'for script in scripts/*.sh scripts/lib/*.sh; do [[ -e "$script" ]] && bash -n "$script"; done; for script in scripts/*.mjs; do node --check "$script"; done'
run_step "doc_script_parity_smoke" pnpm --silent doc-script-parity-smoke
run_step "check" pnpm --silent check
run_step "db_validate" pnpm --silent db:validate
run_step "secrets_validate" pnpm --silent secrets:validate
run_step "core_db_plane_worker_build" bash -c \
  'pnpm --silent --filter @agent-control-plane/core build && pnpm --silent --filter @agent-control-plane/db build && pnpm --silent --filter @agent-control-plane/plane build && pnpm --silent --filter @agent-control-plane/worker build'
run_step "operator_query_smoke" pnpm --silent operator:query-smoke
run_step "linear_migration_smoke" pnpm --silent linear:migrate-smoke
run_step "plane_human_gate_writeback_smoke" pnpm --silent plane:human-gate-writeback-smoke
run_step "codex_adapter_smoke" pnpm --silent codex:adapter-smoke
run_step "codex_app_server_smoke" pnpm --silent codex:app-server-smoke
run_step "worker_codex_smoke" pnpm --silent worker:codex-smoke
run_step "worker_codex_app_server_followup_smoke" env WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true pnpm --silent worker:codex-smoke
run_step "worker_codex_plane_smoke_skip" pnpm --silent worker:codex-plane-smoke
run_step "worker_codex_plane_app_server_smoke_skip" env WORKER_EXECUTION_ADAPTER=codex-app-server pnpm --silent worker:codex-plane-smoke
run_step "worker_codex_plane_app_server_followup_smoke_skip" env WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm --silent worker:codex-plane-smoke
run_step "openhands_payload_contract" pnpm --silent openhands:payload-contract
run_step "task_source_local_smoke" pnpm --silent task-source:local-smoke
run_step "worker_fairness_smoke" pnpm --silent worker:fairness-smoke
run_step "worker_workspace_smoke" pnpm --silent worker:workspace-smoke
run_step "worker_lease_smoke" pnpm --silent worker:lease-smoke
run_step "worker_crash_smoke" pnpm --silent worker:crash-smoke
run_step "worker_budget_smoke" pnpm --silent worker:budget-smoke
run_step "worker_workflow_smoke" pnpm --silent worker:workflow-smoke
run_step "workspace_cleanup_smoke" pnpm --silent workspace:cleanup-smoke
run_step "cutover_report_smoke" pnpm --silent cutover:report-smoke
run_step "external_preflight_smoke" pnpm --silent external:preflight-smoke
run_step "completion_doctor_smoke" pnpm --silent completion:doctor-smoke
run_step "completion_gap_smoke" pnpm --silent completion:gap-smoke
run_step "completion_final_env_template_smoke" pnpm --silent completion:final-env-template-smoke
run_step "completion_audit_smoke" pnpm --silent completion:audit-smoke
run_step "completion_final_smoke" pnpm --silent completion:final-smoke
run_step "completion_local_web_build_smoke" pnpm --silent completion:local-web-build-smoke
run_step "cutover_codex_rehearsal" pnpm --silent cutover:codex-rehearsal
run_step "cutover_rehearsal" pnpm --silent cutover:rehearsal

WEB_BUILD_MODE="${ACP_LOCAL_COMPLETION_RUN_WEB_BUILD:-auto}"

if [[ "$WEB_BUILD_MODE" == "true" ]]; then
  lock_holders="$(next_lock_holders || true)"
  if [[ -n "$lock_holders" ]]; then
    echo "local_completion_web_build=blocked" >&2
    echo "detail=apps/web/.next/dev/lock is held by ${lock_holders}" >&2
    echo "hint=stop the local Next dev server before running Web production build" >&2
    exit 1
  fi
  run_step "web_build" run_web_build_with_retry
elif [[ "$WEB_BUILD_MODE" == "auto" ]]; then
  lock_holders="$(next_lock_holders || true)"
  if [[ -n "$lock_holders" ]]; then
    echo "local_completion_web_build=skipped"
    echo "detail=Web build skipped; apps/web/.next/dev/lock is held by ${lock_holders}"
  else
    run_step "web_build" run_web_build_with_retry
  fi
elif [[ "$WEB_BUILD_MODE" == "false" ]]; then
  echo "local_completion_web_build=skipped"
  echo "detail=Web build skipped by ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=false"
else
  echo "local_completion_web_build=failed" >&2
  echo "detail=ACP_LOCAL_COMPLETION_RUN_WEB_BUILD must be auto, true, or false" >&2
  exit 1
fi

echo "local_completion_smoke=passed"
