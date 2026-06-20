#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

BASE_URL="${ACP_SMOKE_BASE_URL:-http://127.0.0.1:3112}"
COOKIE_JAR="$(mktemp)"
AUTH_HEADER=()
EXTERNAL_PLANE_EVIDENCE=""
EXTERNAL_OPENHANDS_EVIDENCE=""
EXTERNAL_LANGFUSE_EVIDENCE=""
EXTERNAL_PLANE_STATUS=""
EXTERNAL_OPENHANDS_STATUS=""
EXTERNAL_LANGFUSE_STATUS=""

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

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

log() {
  printf 'smoke_step=%s\n' "$1"
}

fail() {
  printf 'smoke_failed=%s\n' "$1" >&2
  exit 1
}

curl_expect() {
  local label="$1"
  local expected_status="$2"
  shift 2
  local body_file status
  body_file="$(mktemp)"
  status="$(
    curl -sS -o "$body_file" -w '%{http_code}' "$@" || {
      cat "$body_file" >&2 || true
      rm -f "$body_file"
      fail "${label}:curl_error"
    }
  )"

  if [[ "$status" != "$expected_status" ]]; then
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    fail "${label}:expected_${expected_status}_got_${status}"
  fi

  rm -f "$body_file"
}

curl_capture_expect() {
  local label="$1"
  local expected_status="$2"
  local output_file="$3"
  shift 3
  local status
  status="$(
    curl -sS -o "$output_file" -w '%{http_code}' "$@" || {
      cat "$output_file" >&2 || true
      fail "${label}:curl_error"
    }
  )"

  if [[ "$status" != "$expected_status" ]]; then
    cat "$output_file" >&2 || true
    fail "${label}:expected_${expected_status}_got_${status}"
  fi
}

validate_readiness_body() {
  if [[ "${ACP_SMOKE_REQUIRE_READINESS_DATABASE:-true}" != "true" ]]; then
    return
  fi

  local body_file="$1"
  node - "$body_file" <<'NODE' || fail "readiness:invalid_body"
const fs = require("node:fs");

try {
  const body = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (body.service !== "agent-control-plane-web") {
    console.error(`readiness_error=unexpected_service:${body.service ?? ""}`);
    process.exit(1);
  }
  if (!body.database || body.database.connected !== true) {
    console.error("readiness_error=database_connected_not_true");
    process.exit(1);
  }
} catch (error) {
  console.error(`readiness_error=${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
NODE
}

load_secret_env_file
load_secret_command

if [[ "${ACP_SMOKE_SKIP_SECRET_VALIDATE:-false}" != "true" ]]; then
  log "secret_validate"
  bash scripts/validate-secrets.sh >/dev/null
fi

log "readiness"
READINESS_BODY_FILE="$(mktemp)"
curl_capture_expect "readiness" "200" "$READINESS_BODY_FILE" "${BASE_URL}/api/readiness"
validate_readiness_body "$READINESS_BODY_FILE"
rm -f "$READINESS_BODY_FILE"

if [[ -n "${ACP_OPERATOR_API_TOKEN:-${CONTROL_PLANE_API_TOKEN:-}}" ]]; then
  AUTH_TOKEN="${ACP_OPERATOR_API_TOKEN:-${CONTROL_PLANE_API_TOKEN:-}}"
  AUTH_HEADER=(-H "authorization: Bearer ${AUTH_TOKEN}")
elif [[ -n "${ACP_OPERATOR_LOGIN_PASSWORD:-}" ]]; then
  log "login"
  curl_expect "login" "200" \
    -c "$COOKIE_JAR" \
    -H "content-type: application/json" \
    -X POST \
    -d "{\"password\":\"${ACP_OPERATOR_LOGIN_PASSWORD}\"}" \
    "${BASE_URL}/api/auth/login"
else
  fail "auth_not_configured"
fi

curl_auth_expect() {
  local label="$1"
  local expected_status="$2"
  shift 2

  if [[ "${#AUTH_HEADER[@]}" -gt 0 ]]; then
    curl_expect "$label" "$expected_status" "${AUTH_HEADER[@]}" "$@"
  else
    curl_expect "$label" "$expected_status" -b "$COOKIE_JAR" "$@"
  fi
}

url_join() {
  local base="$1"
  local path="$2"
  printf '%s/%s' "${base%/}" "${path#/}"
}

curl_plane_expect() {
  local label="$1"
  local expected_status="$2"
  local path="$3"
  curl_expect "$label" "$expected_status" \
    -H "X-API-Key: ${PLANE_API_KEY}" \
    "$(url_join "$PLANE_BASE_URL" "$path")"
}

curl_bearer_expect() {
  local label="$1"
  local expected_status="$2"
  local token="$3"
  local url="$4"
  curl_expect "$label" "$expected_status" -H "authorization: Bearer ${token}" "$url"
}

curl_basic_expect() {
  local label="$1"
  local expected_status="$2"
  local username="$3"
  local password="$4"
  local url="$5"
  curl_expect "$label" "$expected_status" -u "${username}:${password}" "$url"
}

require_external_env() {
  local name="$1"
  local label="$2"
  if [[ -z "${!name:-}" ]]; then
    fail "${label}:${name}_missing"
  fi
}

smoke_external_dependencies() {
  if [[ "${ACP_SMOKE_EXTERNAL:-false}" != "true" ]]; then
    return
  fi

  local completion_profile="${ACP_COMPLETION_EXECUTION_PROFILE:-codex-cli}"

  log "external_plane"
  require_external_env "PLANE_BASE_URL" "external_plane"
  require_external_env "PLANE_WORKSPACE_SLUG" "external_plane"
  require_external_env "PLANE_PROJECT_ID" "external_plane"
  require_external_env "PLANE_API_KEY" "external_plane"
  curl_plane_expect \
    "external_plane" \
    "${ACP_SMOKE_PLANE_EXPECTED_STATUS:-200}" \
    "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/states/"
  EXTERNAL_PLANE_EVIDENCE="${PLANE_BASE_URL%/}/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/states/"
  EXTERNAL_PLANE_STATUS="${ACP_SMOKE_PLANE_EXPECTED_STATUS:-200}"

  if [[ "$completion_profile" != "codex-cli" ]]; then
    log "external_openhands"
    require_external_env "OPENHANDS_BASE_URL" "external_openhands"
    require_external_env "OPENHANDS_API_KEY" "external_openhands"
    local openhands_probe_url
    openhands_probe_url="$(url_join "$OPENHANDS_BASE_URL" "${ACP_SMOKE_OPENHANDS_PROBE_PATH:-/api/v1/app-conversations?ids=__acp_smoke_probe__}")"
    curl_bearer_expect \
      "external_openhands" \
      "${ACP_SMOKE_OPENHANDS_EXPECTED_STATUS:-200}" \
      "$OPENHANDS_API_KEY" \
      "$openhands_probe_url"
    EXTERNAL_OPENHANDS_EVIDENCE="$openhands_probe_url"
    EXTERNAL_OPENHANDS_STATUS="${ACP_SMOKE_OPENHANDS_EXPECTED_STATUS:-200}"

    log "external_langfuse"
    require_external_env "LANGFUSE_BASE_URL" "external_langfuse"
    local langfuse_probe_url
    langfuse_probe_url="$(url_join "$LANGFUSE_BASE_URL" "${ACP_SMOKE_LANGFUSE_PROBE_PATH:-/api/public/health}")"
    if [[ -n "${LANGFUSE_PUBLIC_KEY:-}" && -n "${LANGFUSE_SECRET_KEY:-}" ]]; then
      curl_basic_expect \
        "external_langfuse" \
        "${ACP_SMOKE_LANGFUSE_EXPECTED_STATUS:-200}" \
        "$LANGFUSE_PUBLIC_KEY" \
        "$LANGFUSE_SECRET_KEY" \
        "$langfuse_probe_url"
    else
      curl_expect \
        "external_langfuse" \
        "${ACP_SMOKE_LANGFUSE_EXPECTED_STATUS:-200}" \
        "$langfuse_probe_url"
    fi
    EXTERNAL_LANGFUSE_EVIDENCE="$langfuse_probe_url"
    EXTERNAL_LANGFUSE_STATUS="${ACP_SMOKE_LANGFUSE_EXPECTED_STATUS:-200}"
  fi
}

log "auth_session"
curl_auth_expect "auth_session" "200" "${BASE_URL}/api/auth/session"

log "runs"
curl_auth_expect "runs" "200" "${BASE_URL}/api/runs?limit=1"

log "tasks"
curl_auth_expect "tasks" "200" "${BASE_URL}/api/tasks?limit=1"

log "audit_events"
curl_auth_expect "audit_events" "200" "${BASE_URL}/api/audit-events?limit=1"

log "users"
curl_auth_expect "users" "200" "${BASE_URL}/api/users?limit=1"

if [[ "${ACP_SMOKE_ENABLE_USER_WRITE:-false}" == "true" ]]; then
  log "users_write"
  curl_auth_expect "users_write" "200" \
    -H "content-type: application/json" \
    -X POST \
    -d '{"externalProvider":"local","externalUserId":"smoke-user","name":"smoke-user"}' \
    "${BASE_URL}/api/users"
fi

smoke_external_dependencies

cat <<EOF
smoke=passed
base_url=${BASE_URL}
write_checks=${ACP_SMOKE_ENABLE_USER_WRITE:-false}
external_checks=${ACP_SMOKE_EXTERNAL:-false}
external_plane_evidence=${EXTERNAL_PLANE_EVIDENCE:-not-run}
external_plane_status=${EXTERNAL_PLANE_STATUS:-not-run}
external_openhands_evidence=${EXTERNAL_OPENHANDS_EVIDENCE:-not-run}
external_openhands_status=${EXTERNAL_OPENHANDS_STATUS:-not-run}
external_langfuse_evidence=${EXTERNAL_LANGFUSE_EVIDENCE:-not-run}
external_langfuse_status=${EXTERNAL_LANGFUSE_STATUS:-not-run}
EOF
