#!/usr/bin/env bash
set -euo pipefail

if [[ "${WORKER_CODEX_REAL_SMOKE_CONFIRM:-false}" != "true" ]]; then
  echo "worker_codex_real_smoke=blocked" >&2
  echo "error=real Codex smoke invokes codex exec and may spend tokens" >&2
  echo "hint=rerun with WORKER_CODEX_REAL_SMOKE_CONFIRM=true pnpm worker:codex-real-smoke" >&2
  exit 2
fi

export WORKER_CODEX_SMOKE_USE_REAL_CODEX="true"
export WORKER_CODEX_MODEL="${WORKER_CODEX_MODEL:-gpt-5.5}"
export WORKER_CODEX_REASONING_EFFORT="${WORKER_CODEX_REASONING_EFFORT:-high}"

bash scripts/smoke-worker-codex.sh
