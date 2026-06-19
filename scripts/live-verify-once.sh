#!/usr/bin/env bash
set -euo pipefail

if [[ "${WORKER_MODE:-}" != "live" ]]; then
  echo "WORKER_MODE=live is required for live verification." >&2
  exit 1
fi

pnpm live:preflight
dispatch_output="$(pnpm --filter @agent-control-plane/worker live-once)"
printf '%s\n' "${dispatch_output}"
evidence_dir="${LIVE_EVIDENCE_DIR:-evidence/live-dispatch}"
evidence_file="${evidence_dir}/live-dispatch-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
printf '%s\n' "${dispatch_output}" | pnpm --filter @agent-control-plane/worker verify-live-dispatch-output --write "${evidence_file}"
echo "live verification evidence saved to ${evidence_file}"
