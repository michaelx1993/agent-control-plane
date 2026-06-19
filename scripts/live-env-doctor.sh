#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

required=(
  DATABASE_URL
  PLANE_BASE_URL
  PLANE_WORKSPACE_SLUG
  PLANE_PROJECT_ID
  PLANE_API_KEY
  OPENHANDS_BASE_URL
  LANGFUSE_BASE_URL
  LANGFUSE_PUBLIC_KEY
  LANGFUSE_SECRET_KEY
)

optional=(
  PLANE_API_KEY_HEADER
  OPENHANDS_API_MODE
  OPENHANDS_HEALTH_PATH
  LANGFUSE_HEALTH_PATH
  OPENHANDS_CONVERSATIONS_PATH
  OPENHANDS_RUNS_PATH
  LANGFUSE_TRACES_PATH
  LANGFUSE_GENERATIONS_PATH
  RUNTIME_PROBE_MUTATE
  RUNTIME_PROBE_REPO
  RUNTIME_PROBE_WORKSPACE_PATH
  RUNTIME_PROBE_PROMPT
  RUNTIME_PROBE_MODEL
  RUNTIME_PROBE_OPENHANDS_POLL_INTERVAL_MS
  RUNTIME_PROBE_OPENHANDS_POLL_ATTEMPTS
  REQUIRE_RUNTIME_PROBE
  CONTROL_PLANE_BASE_URL
  CONTROL_PLANE_API_TOKEN
  CONTROL_PLANE_READ_API_TOKEN
  BACKUP_FILE
  BACKUP_DIR
  RESTORE_DRILL_DATABASE_URL
)

missing=0

print_var() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value}" ]]; then
    printf 'missing %s\n' "${name}"
    return 1
  fi

  if [[ "${name}" =~ (KEY|TOKEN|SECRET|PASSWORD|PASS) ]]; then
    printf 'ok %s=<redacted>\n' "${name}"
  else
    printf 'ok %s=%s\n' "${name}" "${value}"
  fi
}

echo "live env required"
for name in "${required[@]}"; do
  if ! print_var "${name}"; then
    missing=1
  fi
done

echo
echo "live env optional"
for name in "${optional[@]}"; do
  value="${!name:-}"
  if [[ -z "${value}" ]]; then
    printf 'unset %s\n' "${name}"
  elif [[ "${name}" =~ (KEY|TOKEN|SECRET|PASSWORD|PASS) ]]; then
    printf 'set %s=<redacted>\n' "${name}"
  else
    printf 'set %s=%s\n' "${name}" "${value}"
  fi
done

echo
echo "local service hints"
if command -v docker >/dev/null 2>&1; then
  plane_containers="$(docker ps --format '{{.Names}}' | awk '/^plane-app-/{print}' | paste -sd ',' -)"
  if [[ -n "${plane_containers}" ]]; then
    echo "ok docker plane containers=${plane_containers}"
  else
    echo "missing docker plane containers"
  fi
else
  echo "skip docker is not installed"
fi

if [[ -n "${PLANE_BASE_URL:-}" ]]; then
  status="$(curl -fsS -o /dev/null -w '%{http_code}' "${PLANE_BASE_URL}/" || true)"
  if [[ "${status}" == "200" ]]; then
    echo "ok Plane UI ${PLANE_BASE_URL}/ returned 200"
  else
    echo "warn Plane UI ${PLANE_BASE_URL}/ returned ${status:-curl-error}"
  fi
fi

if [[ "${missing}" -ne 0 ]]; then
  echo
  echo "live env doctor failed: required variables are missing. Copy .env.example to .env and fill the missing values before pnpm live:preflight." >&2
  exit 1
fi

echo
echo "live env doctor passed"
