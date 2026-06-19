#!/usr/bin/env bash
set -euo pipefail

if [[ "${WORKER_MODE:-}" != "live" ]]; then
  echo "WORKER_MODE=live is required for a live dispatch." >&2
  exit 1
fi

pnpm live:preflight
pnpm --filter @agent-control-plane/worker live-once
