#!/usr/bin/env bash
set -euo pipefail

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
  grep -n -v -E '^[[:space:]]*($|#|[A-Za-z_][A-Za-z0-9_]*=)' "$tmp_file" || true
)"
if [[ -n "$invalid_lines" ]]; then
  echo "secret_provider_smoke=failed" >&2
  echo "error: ACP_SECRET_COMMAND output is not dotenv-compatible" >&2
  echo "$invalid_lines" | sed 's/=.*/=<redacted>/' >&2
  exit 1
fi

variable_names="$(
  grep -E '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' "$tmp_file" \
    | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/' \
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
