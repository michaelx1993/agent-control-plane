#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

ENVIRONMENT="${ACP_ENV:-${NODE_ENV:-development}}"
STRICT="${SECRET_VALIDATION_STRICT:-}"

if [[ -z "$STRICT" ]]; then
  if [[ "$ENVIRONMENT" == "production" || "$ENVIRONMENT" == "prod" ]]; then
    STRICT="true"
  else
    STRICT="false"
  fi
fi

declare -a ERRORS=()
declare -a WARNINGS=()
SECRET_EXPIRY_WARNING_DAYS="${SECRET_EXPIRY_WARNING_DAYS:-14}"

if [[ ! "$SECRET_EXPIRY_WARNING_DAYS" =~ ^[0-9]+$ ]]; then
  WARNINGS+=("SECRET_EXPIRY_WARNING_DAYS is invalid; falling back to 14")
  SECRET_EXPIRY_WARNING_DAYS="14"
fi

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if is_placeholder_value "$file"; then
    ERRORS+=("ACP_SECRET_ENV_FILE: still contains a template placeholder")
    return
  fi

  if [[ ! -f "$file" ]]; then
    ERRORS+=("ACP_SECRET_ENV_FILE: file not found (${file})")
    return
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    ERRORS+=("ACP_SECRET_ENV_FILE: file permissions must be 600 or 400 (${file})")
    return
  fi

  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    ERRORS+=("ACP_SECRET_ENV_FILE: ${load_error}")
  fi
  rm -f "$load_error_file"
}

load_secret_command() {
  local command="${ACP_SECRET_COMMAND:-}"
  if [[ -z "$command" ]]; then
    return
  fi

  if is_placeholder_value "$command"; then
    ERRORS+=("ACP_SECRET_COMMAND: still contains a template placeholder")
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! bash -c "$command" >"$tmp_file"; then
    rm -f "$tmp_file"
    ERRORS+=("ACP_SECRET_COMMAND: command failed")
    return
  fi

  chmod 600 "$tmp_file"
  local load_error_file load_error
  load_error_file="$(mktemp)"
  if ! load_dotenv_file_safe "$tmp_file" 2>"$load_error_file"; then
    load_error="$(<"$load_error_file")"
    ERRORS+=("ACP_SECRET_COMMAND: ${load_error}")
  fi
  rm -f "$load_error_file"
  rm -f "$tmp_file"
}

is_placeholder_value() {
  local value="$1"
  [[ "$value" == *"<"*">"* || "$value" == *"example.com"* || "$value" == *"YYYY-MM-DD"* || "$value" == "owner/repo" ]]
}

mask_value() {
  local value="$1"
  local length="${#value}"
  if [[ "$length" -le 4 ]]; then
    printf '****'
    return
  fi

  printf '%s****%s' "${value:0:2}" "${value: -2}"
}

record_missing() {
  local name="$1"
  local reason="$2"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    ERRORS+=("${name}: missing (${reason})")
  fi
}

record_warning() {
  local message="$1"
  WARNINGS+=("$message")
}

is_weak_secret() {
  local value="$1"
  local lower
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"

  case "$lower" in
    secret | token | password | changeme | change-me | local-dev-token | test | dummy | example)
      return 0
      ;;
  esac

  [[ "${#value}" -lt 24 ]]
}

check_required_secret() {
  local name="$1"
  local reason="$2"
  local value="${!name:-}"

  record_missing "$name" "$reason"
  if [[ -n "$value" ]]; then
    if is_weak_secret "$value"; then
      ERRORS+=("${name}: weak value $(mask_value "$value") (${reason})")
    fi
  fi
}

check_optional_secret_strength() {
  local name="$1"
  local value="${!name:-}"

  if [[ -n "$value" ]]; then
    if is_weak_secret "$value"; then
      ERRORS+=("${name}: weak value $(mask_value "$value")")
    fi
  fi
}

days_until_timestamp() {
  local timestamp="$1"
  node -e "const ts = Date.parse(process.argv[1]); if (Number.isNaN(ts)) process.exit(2); console.log(Math.floor((ts - Date.now()) / 86400000));" "$timestamp"
}

check_secret_expiry() {
  local expires_at="${ACP_SECRET_EXPIRES_AT:-}"
  local rotated_at="${ACP_SECRET_ROTATED_AT:-}"

  if [[ -z "$expires_at" ]]; then
    if [[ -n "${ACP_SECRET_ENV_FILE:-}" ]]; then
      record_warning "ACP_SECRET_EXPIRES_AT is missing; run pnpm secrets:rotate to generate rotation metadata"
    fi
    return
  fi

  local days_left
  if ! days_left="$(days_until_timestamp "$expires_at" 2>/dev/null)"; then
    ERRORS+=("ACP_SECRET_EXPIRES_AT: invalid timestamp")
    return
  fi

  if [[ "$days_left" -lt 0 ]]; then
    ERRORS+=("ACP_SECRET_EXPIRES_AT: expired ${expires_at}; rotate secrets before deploying")
    return
  fi

  if [[ "$days_left" -le "$SECRET_EXPIRY_WARNING_DAYS" ]]; then
    record_warning "secrets expire in ${days_left} day(s) at ${expires_at}"
  fi

  if [[ -n "$rotated_at" ]]; then
    if ! days_until_timestamp "$rotated_at" >/dev/null 2>&1; then
      ERRORS+=("ACP_SECRET_ROTATED_AT: invalid timestamp")
    fi
  fi
}

load_secret_env_file
load_secret_command
check_secret_expiry

if [[ "$STRICT" == "true" ]]; then
  record_missing "DATABASE_URL" "application database connection"
  check_required_secret "ACP_OPERATOR_API_TOKEN" "operator API protection is required outside local development"
  check_required_secret "ACP_OPERATOR_LOGIN_PASSWORD" "operator browser login"
  check_required_secret "ACP_OPERATOR_SESSION_SECRET" "operator signed session cookie"
  check_optional_secret_strength "CONTROL_PLANE_API_TOKEN"

  record_missing "PLANE_WEBHOOK_SECRET" "Plane webhook verification"

  if [[ "${PLANE_WRITEBACK_ENABLED:-false}" == "true" ]]; then
    record_missing "PLANE_BASE_URL" "Plane writeback"
    record_missing "PLANE_WORKSPACE_SLUG" "Plane writeback"
    record_missing "PLANE_PROJECT_ID" "Plane writeback"
    check_required_secret "PLANE_API_KEY" "Plane writeback"
  fi

  if [[ "${WORKER_EXECUTION_ADAPTER:-codex-cli}" == "openhands-cloud" ]]; then
    record_missing "OPENHANDS_BASE_URL" "OpenHands Cloud adapter"
    check_required_secret "OPENHANDS_API_KEY" "OpenHands Cloud adapter"
  fi

  if [[ "${LANGFUSE_ENABLED:-false}" == "true" ]]; then
    record_missing "LANGFUSE_BASE_URL" "Langfuse tracing"
    record_missing "LANGFUSE_PROJECT_ID" "Langfuse trace UI links"
    check_required_secret "LANGFUSE_PUBLIC_KEY" "Langfuse tracing"
    check_required_secret "LANGFUSE_SECRET_KEY" "Langfuse tracing"
  fi

  if [[ -n "${MONITORING_ALERT_WEBHOOK_URL:-}" ]]; then
    case "${MONITORING_ALERT_FORMAT:-generic}" in
      generic | slack | email) ;;
      *) ERRORS+=("MONITORING_ALERT_FORMAT: must be generic, slack, or email") ;;
    esac
  fi
else
  if [[ -z "${ACP_OPERATOR_API_TOKEN:-${CONTROL_PLANE_API_TOKEN:-}}" ]]; then
    record_warning "operator API token is empty; this is acceptable only for local development"
  fi

  if [[ "${LANGFUSE_ENABLED:-false}" == "true" && -z "${LANGFUSE_SECRET_KEY:-}" ]]; then
    record_warning "LANGFUSE_ENABLED=true but LANGFUSE_SECRET_KEY is empty; tracing will stay disabled"
  fi
fi

if [[ "${#WARNINGS[@]}" -gt 0 ]]; then
  echo "secret_validation_warnings=${#WARNINGS[@]}"
  for warning in "${WARNINGS[@]}"; do
    echo "warning: ${warning}"
  done
fi

if [[ "${#ERRORS[@]}" -gt 0 ]]; then
  echo "secret_validation=failed"
  for error in "${ERRORS[@]}"; do
    echo "error: ${error}" >&2
  done
  exit 1
fi

cat <<EOF
secret_validation=passed
environment=${ENVIRONMENT}
strict=${STRICT}
EOF
