#!/usr/bin/env bash
set -euo pipefail

SMOKE_SCRIPT="${1:-}"
if [[ -z "$SMOKE_SCRIPT" ]]; then
  echo "agent_worker_smoke_delegate=failed" >&2
  echo "error=missing_smoke_script" >&2
  exit 1
fi

case "$SMOKE_SCRIPT" in
  codex:adapter-smoke | codex:app-server-smoke) ;;
  *)
    echo "agent_worker_smoke_delegate=failed" >&2
    echo "error=unsupported_smoke_script" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_WORKER_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)/agent-worker"
WORKER_REPO="${AGENT_WORKER_REPO_PATH:-$DEFAULT_WORKER_REPO}"

if [[ ! -d "$WORKER_REPO" ]]; then
  echo "agent_worker_smoke_delegate=failed" >&2
  echo "error=agent_worker_repo_not_found" >&2
  echo "agent_worker_repo=$WORKER_REPO" >&2
  exit 1
fi

if [[ ! -f "$WORKER_REPO/package.json" ]]; then
  echo "agent_worker_smoke_delegate=failed" >&2
  echo "error=agent_worker_package_json_not_found" >&2
  echo "agent_worker_repo=$WORKER_REPO" >&2
  exit 1
fi

pnpm --dir "$WORKER_REPO" --silent "$SMOKE_SCRIPT"
