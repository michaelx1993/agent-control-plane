#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cat >"$TMP_DIR/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
count_file="${READINESS_SMOKE_COUNT_FILE:?}"
count="$(cat "$count_file" 2>/dev/null || printf '0')"
count="$((count + 1))"
printf '%s' "$count" >"$count_file"
if [[ "${READINESS_SMOKE_MODE:-success_after_two}" == "always_fail" ]]; then
  exit 56
fi
if [[ "$count" -lt 2 ]]; then
  exit 56
fi
exit 0
SH
chmod +x "$TMP_DIR/curl"

export PATH="$TMP_DIR:$PATH"
export READINESS_URL="http://127.0.0.1:3112/api/readiness"
export READINESS_RETRIES=3
export READINESS_RETRY_DELAY_SECONDS=0
export READINESS_SMOKE_COUNT_FILE="$TMP_DIR/count"

# shellcheck source=scripts/lib/readiness.sh
source "$ROOT_DIR/scripts/lib/readiness.sh"

wait_for_readiness >/tmp/readiness-smoke-success.out
if [[ "$(cat "$READINESS_SMOKE_COUNT_FILE")" != "2" ]]; then
  echo "readiness_retry_smoke=failed reason=expected_two_attempts" >&2
  exit 1
fi

printf '0' >"$READINESS_SMOKE_COUNT_FILE"
export READINESS_RETRIES=2
export READINESS_SMOKE_MODE=always_fail
if wait_for_readiness >/tmp/readiness-smoke-failure.out 2>/tmp/readiness-smoke-failure.err; then
  echo "readiness_retry_smoke=failed reason=expected_failure" >&2
  exit 1
fi
if [[ "$(cat "$READINESS_SMOKE_COUNT_FILE")" != "2" ]]; then
  echo "readiness_retry_smoke=failed reason=expected_failure_two_attempts" >&2
  exit 1
fi

echo "readiness_retry_smoke=passed"
