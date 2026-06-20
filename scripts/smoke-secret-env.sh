#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

VALID_FILE="$TMP_DIR/valid.env"
UNSAFE_FILE="$TMP_DIR/unsafe.env"

cat >"$VALID_FILE" <<'EOF'
# Comments and blank lines are ignored.

export PLAIN_VALUE=plain
QUOTED_VALUE="quoted value"
SINGLE_QUOTED_VALUE='single quoted value'
EOF

load_dotenv_file_safe "$VALID_FILE"

[[ "${PLAIN_VALUE:-}" == "plain" ]]
[[ "${QUOTED_VALUE:-}" == "quoted value" ]]
[[ "${SINGLE_QUOTED_VALUE:-}" == "single quoted value" ]]

cat >"$UNSAFE_FILE" <<'EOF'
export BAD_VALUE=$(echo unsafe)
EOF

if load_dotenv_file_safe "$UNSAFE_FILE" >/dev/null 2>&1; then
  echo "secret_env_smoke=failed" >&2
  echo "error=unsafe_command_substitution_allowed" >&2
  exit 1
fi

echo "secret_env_smoke=passed"
