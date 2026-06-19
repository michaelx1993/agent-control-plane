#!/usr/bin/env bash
set -euo pipefail

if [[ "${WORKER_MODE:-}" != "live" ]]; then
  echo "WORKER_MODE=live is required for live verification." >&2
  exit 1
fi

pnpm live:preflight
dispatch_output="$(pnpm --filter @agent-control-plane/worker live-once)"
printf '%s\n' "${dispatch_output}"
printf '%s\n' "${dispatch_output}" | pnpm --filter @agent-control-plane/worker verify-live-dispatch-output
