#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

if [[ -n "${ACP_SECRET_ENV_FILE:-}" ]]; then
  load_dotenv_file_safe "$ACP_SECRET_ENV_FILE"
fi

pnpm --filter @agent-control-plane/core build >/dev/null
pnpm --filter @agent-control-plane/db build >/dev/null
pnpm --filter @agent-control-plane/plane build >/dev/null

node "$SCRIPT_DIR/plane-sync.mjs"
