#!/usr/bin/env bash

run_web_build_with_retry() {
  local max_retries="${ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES:-1}"
  local retry_delay_seconds="${ACP_LOCAL_COMPLETION_WEB_BUILD_RETRY_DELAY_SECONDS:-3}"
  local attempt=0

  if ! [[ "$max_retries" =~ ^[0-9]+$ ]]; then
    echo "local_completion_web_build=failed" >&2
    echo "detail=ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES must be a non-negative integer" >&2
    return 1
  fi
  if ! [[ "$retry_delay_seconds" =~ ^[0-9]+$ ]]; then
    echo "local_completion_web_build=failed" >&2
    echo "detail=ACP_LOCAL_COMPLETION_WEB_BUILD_RETRY_DELAY_SECONDS must be a non-negative integer" >&2
    return 1
  fi

  while true; do
    local output_file
    output_file="$(mktemp "${TMPDIR:-/tmp}/acp-web-build.XXXXXX")"
    set +e
    pnpm --silent --filter @agent-control-plane/web build >"$output_file" 2>&1
    local status=$?
    set -e
    cat "$output_file"

    if [[ "$status" -eq 0 ]]; then
      rm -f "$output_file"
      return 0
    fi

    if grep -q "Another next build process is already running" "$output_file" && [[ "$attempt" -lt "$max_retries" ]]; then
      attempt=$((attempt + 1))
      echo "local_completion_web_build=retrying"
      echo "detail=Next build lock detected; retry ${attempt}/${max_retries} after ${retry_delay_seconds}s"
      rm -f "$output_file"
      sleep "$retry_delay_seconds"
      continue
    fi

    rm -f "$output_file"
    return "$status"
  done
}
