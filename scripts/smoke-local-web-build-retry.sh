#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/web-build-retry.sh
source "$SCRIPT_DIR/lib/web-build-retry.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "completion_local_web_build_smoke=failed" >&2
  echo "detail=$1" >&2
  exit 1
}

mkdir -p "$TMP_DIR/bin"
cat >"$TMP_DIR/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

count_file="${WEB_BUILD_STUB_COUNT_FILE:?}"
count="$(cat "$count_file" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" >"$count_file"

case "${WEB_BUILD_STUB_MODE:?}" in
  lock_then_success)
    if [[ "$count" -eq 1 ]]; then
      echo "Another next build process is already running"
      exit 1
    fi
    echo "stub_web_build=passed"
    ;;
  non_lock_failure)
    echo "TypeScript compilation failed"
    exit 2
    ;;
  *)
    echo "unknown WEB_BUILD_STUB_MODE=${WEB_BUILD_STUB_MODE}" >&2
    exit 64
    ;;
esac
STUB
chmod +x "$TMP_DIR/bin/pnpm"

LOCK_OUTPUT="$TMP_DIR/lock-then-success.out"
(
  export PATH="$TMP_DIR/bin:$PATH"
  export WEB_BUILD_STUB_MODE="lock_then_success"
  export WEB_BUILD_STUB_COUNT_FILE="$TMP_DIR/lock-count"
  export ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES="1"
  export ACP_LOCAL_COMPLETION_WEB_BUILD_RETRY_DELAY_SECONDS="0"
  run_web_build_with_retry >"$LOCK_OUTPUT" 2>&1
) || fail "lock retry path failed"

grep -q "local_completion_web_build=retrying" "$LOCK_OUTPUT" || fail "lock retry marker absent"
grep -q "stub_web_build=passed" "$LOCK_OUTPUT" || fail "retry success output absent"
[[ "$(<"$TMP_DIR/lock-count")" == "2" ]] || fail "lock retry did not call pnpm exactly twice"

INVALID_RETRIES_OUTPUT="$TMP_DIR/invalid-retries.out"
if (
  export PATH="$TMP_DIR/bin:$PATH"
  export WEB_BUILD_STUB_MODE="lock_then_success"
  export WEB_BUILD_STUB_COUNT_FILE="$TMP_DIR/invalid-count"
  export ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES="bad"
  export ACP_LOCAL_COMPLETION_WEB_BUILD_RETRY_DELAY_SECONDS="0"
  run_web_build_with_retry >"$INVALID_RETRIES_OUTPUT" 2>&1
); then
  fail "invalid retry count unexpectedly passed"
fi
grep -q "ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES must be a non-negative integer" "$INVALID_RETRIES_OUTPUT" ||
  fail "invalid retry count diagnostic absent"
[[ ! -e "$TMP_DIR/invalid-count" ]] || fail "invalid retry count should fail before invoking pnpm"

NON_LOCK_OUTPUT="$TMP_DIR/non-lock-failure.out"
if (
  export PATH="$TMP_DIR/bin:$PATH"
  export WEB_BUILD_STUB_MODE="non_lock_failure"
  export WEB_BUILD_STUB_COUNT_FILE="$TMP_DIR/non-lock-count"
  export ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES="3"
  export ACP_LOCAL_COMPLETION_WEB_BUILD_RETRY_DELAY_SECONDS="0"
  run_web_build_with_retry >"$NON_LOCK_OUTPUT" 2>&1
); then
  fail "non-lock failure unexpectedly passed"
fi
grep -q "TypeScript compilation failed" "$NON_LOCK_OUTPUT" || fail "non-lock failure output absent"
if grep -q "local_completion_web_build=retrying" "$NON_LOCK_OUTPUT"; then
  fail "non-lock failure retried unexpectedly"
fi
[[ "$(<"$TMP_DIR/non-lock-count")" == "1" ]] || fail "non-lock failure should call pnpm once"

echo "completion_local_web_build_smoke=passed"
echo "lock_retry_verified=true"
echo "invalid_retry_config_rejected=true"
echo "non_lock_failure_not_retried=true"
