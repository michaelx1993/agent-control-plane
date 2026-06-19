#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CONTROL_PLANE_BASE_URL:-http://127.0.0.1:3100}"

check_endpoint() {
  local path="$1"
  local status
  status="$(curl -fsS -o /tmp/agent-control-plane-health.json -w "%{http_code}" "${BASE_URL}${path}")"
  if [[ "${status}" != "200" ]]; then
    echo "health-check failed: ${path} returned ${status}" >&2
    exit 1
  fi
  echo "ok ${path}"
}

check_endpoint "/api/health"
check_endpoint "/api/tasks"
check_endpoint "/api/runs"
check_endpoint "/api/timeline"
check_endpoint "/api/readiness"
check_endpoint "/api/prompt-releases"
check_endpoint "/api/prompt-components"
check_endpoint "/api/prompt-scopes"

echo "health-check passed for ${BASE_URL}"
