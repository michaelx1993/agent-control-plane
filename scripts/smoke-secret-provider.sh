#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

COMMAND="${ACP_SECRET_COMMAND:-}"
if [[ -z "$COMMAND" ]]; then
  echo "secret_provider_smoke=failed" >&2
  echo "error: ACP_SECRET_COMMAND is required" >&2
  exit 1
fi

tmp_file="$(mktemp)"
stderr_file="$(mktemp)"

cleanup() {
  rm -f "$tmp_file" "$stderr_file"
}
trap cleanup EXIT

if ! bash -c "$COMMAND" >"$tmp_file" 2>"$stderr_file"; then
  echo "secret_provider_smoke=failed" >&2
  echo "error: ACP_SECRET_COMMAND failed" >&2
  exit 1
fi

chmod 600 "$tmp_file"

if [[ ! -s "$tmp_file" ]]; then
  echo "secret_provider_smoke=failed" >&2
  echo "error: ACP_SECRET_COMMAND produced empty output" >&2
  exit 1
fi

invalid_lines="$(
  grep -n -v -E '^[[:space:]]*($|#|(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=)' "$tmp_file" || true
)"
if [[ -n "$invalid_lines" ]]; then
  echo "secret_provider_smoke=failed" >&2
  echo "error: ACP_SECRET_COMMAND output is not dotenv-compatible" >&2
  echo "$invalid_lines" | sed 's/=.*/=<redacted>/' >&2
  exit 1
fi

load_error_file="$(mktemp)"
if ! load_dotenv_file_safe "$tmp_file" 2>"$load_error_file"; then
  echo "secret_provider_smoke=failed" >&2
  echo "error: ACP_SECRET_COMMAND output is not dotenv-compatible" >&2
  sed 's/=.*/=<redacted>/' "$load_error_file" >&2
  rm -f "$load_error_file"
  exit 1
fi
rm -f "$load_error_file"

variable_names="$(
  grep -E '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$tmp_file" \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/' \
    | sort -u \
    | paste -sd ',' -
)"
variable_count=0
if [[ -n "$variable_names" ]]; then
  variable_count="$(printf '%s' "$variable_names" | awk -F ',' '{ print NF }')"
fi

if [[ "$variable_count" -eq 0 ]]; then
  echo "secret_provider_smoke=failed" >&2
  echo "error: ACP_SECRET_COMMAND produced no variables" >&2
  exit 1
fi

ACP_SECRET_COMMAND="" \
  ACP_SECRET_ENV_FILE="$tmp_file" \
  ACP_ENV="${ACP_ENV:-production}" \
  bash scripts/validate-secrets.sh >/dev/null

cat <<EOF
secret_provider_smoke=passed
variables=${variable_count}
variable_names=${variable_names}
validation=passed
EOF
