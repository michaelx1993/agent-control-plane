#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

fail() {
  printf 'langfuse_smoke=failed\n' >&2
  printf 'error=%s\n' "$1" >&2
  exit 1
}

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if [[ ! -f "$file" ]]; then
    fail "secret_env_file_not_found"
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    fail "secret_env_file_permissions"
  fi

  if ! load_dotenv_file_safe "$file"; then
    fail "secret_env_file_invalid"
  fi
}

load_secret_command() {
  local command="${ACP_SECRET_COMMAND:-}"
  if [[ -z "$command" ]]; then
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! bash -c "$command" >"$tmp_file"; then
    rm -f "$tmp_file"
    fail "secret_command_failed"
  fi

  chmod 600 "$tmp_file"
  if ! load_dotenv_file_safe "$tmp_file"; then
    fail "secret_command_invalid_dotenv"
  fi
  rm -f "$tmp_file"
}

load_secret_env_file
load_secret_command

pnpm --filter @agent-control-plane/worker langfuse:smoke
