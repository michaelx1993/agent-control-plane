#!/usr/bin/env bash

wait_for_readiness() {
  local url="${READINESS_URL:-http://127.0.0.1:3112/api/readiness}"
  local retries="${READINESS_RETRIES:-30}"
  local delay_seconds="${READINESS_RETRY_DELAY_SECONDS:-2}"

  if ! is_positive_integer "$retries"; then
    echo "readiness_check=failed reason=invalid_retries value=${retries}" >&2
    return 2
  fi

  if ! is_non_negative_integer "$delay_seconds"; then
    echo "readiness_check=failed reason=invalid_retry_delay value=${delay_seconds}" >&2
    return 2
  fi

  for attempt in $(seq 1 "$retries"); do
    if curl -fsS "$url" >/dev/null; then
      echo "readiness_check=passed"
      echo "readiness_url=${url}"
      echo "readiness_attempt=${attempt}"
      return 0
    fi

    if [[ "$attempt" != "$retries" ]]; then
      sleep "$delay_seconds"
    fi
  done

  echo "readiness_check=failed reason=not_ready url=${url} attempts=${retries}" >&2
  return 1
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

is_non_negative_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}
