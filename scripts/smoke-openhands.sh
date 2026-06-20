#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

BASE_URL="${OPENHANDS_BASE_URL:-}"
API_KEY="${OPENHANDS_API_KEY:-}"
PROBE_PATH="${OPENHANDS_SMOKE_PROBE_PATH:-/api/v1/app-conversations?ids=__acp_smoke_probe__}"
CREATE_CONVERSATION="${OPENHANDS_SMOKE_CREATE_CONVERSATION:-false}"
MESSAGE="${OPENHANDS_SMOKE_MESSAGE:-Agent Control Plane OpenHands smoke. Return a short confirmation.}"
SELECTED_REPOSITORY="${OPENHANDS_SMOKE_SELECTED_REPOSITORY:-${OPENHANDS_SELECTED_REPOSITORY:-}}"
WAIT_READY="${OPENHANDS_SMOKE_WAIT_READY:-false}"
POLL_ATTEMPTS="${OPENHANDS_SMOKE_POLL_ATTEMPTS:-12}"
POLL_INTERVAL_SECONDS="${OPENHANDS_SMOKE_POLL_INTERVAL_SECONDS:-5}"
PAYLOAD_FILE="${OPENHANDS_SMOKE_PAYLOAD_FILE:-}"
EVENT_LOG_PATH_TEMPLATE="${OPENHANDS_SMOKE_EVENT_LOG_PATH_TEMPLATE:-${OPENHANDS_EVENT_LOG_PATH_TEMPLATE:-}}"

fail() {
  printf 'openhands_smoke=failed\n' >&2
  printf 'error=%s\n' "$1" >&2
  exit 1
}

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

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "${name}_missing"
  fi
}

url_join() {
  local base="$1"
  local path="$2"
  if [[ "$path" == http://* || "$path" == https://* ]]; then
    printf '%s' "$path"
    return
  fi
  printf '%s/%s' "${base%/}" "${path#/}"
}

curl_openhands() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local body_file status
  body_file="$(mktemp)"

  if [[ -n "$body" ]]; then
    status="$(
      curl -sS -o "$body_file" -w '%{http_code}' \
        -X "$method" \
        -H "authorization: Bearer ${OPENHANDS_API_KEY}" \
        -H "content-type: application/json" \
        -d "$body" \
        "$(url_join "$OPENHANDS_BASE_URL" "$path")" || {
          cat "$body_file" >&2 || true
          rm -f "$body_file"
          fail "curl_error"
        }
    )"
  else
    status="$(
      curl -sS -o "$body_file" -w '%{http_code}' \
        -X "$method" \
        -H "authorization: Bearer ${OPENHANDS_API_KEY}" \
        -H "content-type: application/json" \
        "$(url_join "$OPENHANDS_BASE_URL" "$path")" || {
          cat "$body_file" >&2 || true
          rm -f "$body_file"
          fail "curl_error"
        }
    )"
  fi

  if [[ "$status" != 2* ]]; then
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    fail "openhands_api_${status}"
  fi

  cat "$body_file"
  rm -f "$body_file"
}

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "$1"
}

extract_conversation_id() {
  node -e '
  const value = JSON.parse(process.argv[1] || "{}");
  const id = value.app_conversation_id ?? (value.status === "READY" ? value.id : undefined);
  if (id) {
    process.stdout.write(String(id));
  }
' "$1"
}

extract_start_task_id() {
  node -e '
  const value = JSON.parse(process.argv[1] || "{}");
  if (value.id) {
    process.stdout.write(String(value.id));
  }
' "$1"
}

extract_ready_conversation_id() {
  node -e '
  const value = JSON.parse(process.argv[1] || "[]");
  const tasks = Array.isArray(value) ? value : Array.isArray(value.results) ? value.results : [];
  const task = tasks[0];
  if (task?.status === "ERROR") {
    process.exit(2);
  }
  if (task?.status === "READY" && task.app_conversation_id) {
    process.stdout.write(String(task.app_conversation_id));
  }
' "$1"
}

extract_first_conversation() {
  node -e '
  const value = JSON.parse(process.argv[1] || "[]");
  const conversations = Array.isArray(value)
    ? value
    : Array.isArray(value.results)
      ? value.results
      : Array.isArray(value.data)
        ? value.data
        : value && typeof value === "object"
          ? [value]
          : [];
  if (conversations[0]) {
    process.stdout.write(JSON.stringify(conversations[0]));
  }
' "$1"
}

resolve_event_log_path() {
  node -e '
  const conversation = JSON.parse(process.argv[1] || "{}");
  const template = process.argv[2] || "";
  const conversationId = process.argv[3] || conversation.id || "";
  const direct =
    conversation.event_log_uri ??
    conversation.eventLogUri ??
    conversation.event_log_url ??
    conversation.eventLogUrl ??
    conversation.events_url ??
    conversation.eventsUrl ??
    conversation.log_url ??
    conversation.logUrl;
  if (typeof direct === "string" && direct.length > 0) {
    process.stdout.write(direct);
  } else if (template && conversationId) {
    process.stdout.write(
      template
        .replaceAll("{conversationId}", encodeURIComponent(conversationId))
        .replaceAll(":conversationId", encodeURIComponent(conversationId)),
    );
  }
' "$1" "$2" "$3"
}

write_payload_contract_file() {
  local file="$1"
  local conversation_json="$2"
  local event_log_json="${3:-}"
  local tmp_file
  mkdir -p "$(dirname "$file")"
  tmp_file="$(mktemp)"
  node - "$conversation_json" "$event_log_json" >"$tmp_file" <<'NODE'
const [conversationRaw, eventLogRaw] = process.argv.slice(2);
const contract = {
  promptReleaseId: process.env.OPENHANDS_SMOKE_PAYLOAD_PROMPT_RELEASE_ID || "openhands-smoke",
  conversation: JSON.parse(conversationRaw),
};
if (eventLogRaw) {
  contract.eventLog = JSON.parse(eventLogRaw);
}
process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
NODE
  install -m 600 "$tmp_file" "$file"
  rm -f "$tmp_file"
}

load_secret_env_file
load_secret_command

BASE_URL="${OPENHANDS_BASE_URL:-$BASE_URL}"
API_KEY="${OPENHANDS_API_KEY:-$API_KEY}"
PROBE_PATH="${OPENHANDS_SMOKE_PROBE_PATH:-$PROBE_PATH}"
CREATE_CONVERSATION="${OPENHANDS_SMOKE_CREATE_CONVERSATION:-$CREATE_CONVERSATION}"
MESSAGE="${OPENHANDS_SMOKE_MESSAGE:-$MESSAGE}"
SELECTED_REPOSITORY="${OPENHANDS_SMOKE_SELECTED_REPOSITORY:-${OPENHANDS_SELECTED_REPOSITORY:-$SELECTED_REPOSITORY}}"
WAIT_READY="${OPENHANDS_SMOKE_WAIT_READY:-$WAIT_READY}"
POLL_ATTEMPTS="${OPENHANDS_SMOKE_POLL_ATTEMPTS:-$POLL_ATTEMPTS}"
POLL_INTERVAL_SECONDS="${OPENHANDS_SMOKE_POLL_INTERVAL_SECONDS:-$POLL_INTERVAL_SECONDS}"
PAYLOAD_FILE="${OPENHANDS_SMOKE_PAYLOAD_FILE:-$PAYLOAD_FILE}"
EVENT_LOG_PATH_TEMPLATE="${OPENHANDS_SMOKE_EVENT_LOG_PATH_TEMPLATE:-${OPENHANDS_EVENT_LOG_PATH_TEMPLATE:-$EVENT_LOG_PATH_TEMPLATE}}"

require_env "OPENHANDS_BASE_URL"
require_env "OPENHANDS_API_KEY"

curl_openhands GET "$PROBE_PATH" >/dev/null

if [[ "$CREATE_CONVERSATION" != "true" ]]; then
  cat <<EOF
openhands_smoke=passed
mode=probe
probe_path=${PROBE_PATH}
EOF
  exit 0
fi

body="{\"initial_message\":{\"content\":[{\"type\":\"text\",\"text\":$(json_string "$MESSAGE")}]}"
if [[ -n "$SELECTED_REPOSITORY" ]]; then
  body="${body},\"selected_repository\":$(json_string "$SELECTED_REPOSITORY")"
fi
body="${body}}"

start_response="$(curl_openhands POST "/api/v1/app-conversations" "$body")"
conversation_id="$(extract_conversation_id "$start_response")"
start_task_id="$(extract_start_task_id "$start_response")"

if [[ -z "$conversation_id" && "$WAIT_READY" == "true" ]]; then
  if [[ -z "$start_task_id" ]]; then
    fail "start_task_id_missing"
  fi

  for ((attempt = 1; attempt <= POLL_ATTEMPTS; attempt++)); do
    task_response="$(curl_openhands GET "/api/v1/app-conversations/start-tasks?ids=${start_task_id}")"
    if conversation_id="$(extract_ready_conversation_id "$task_response")"; then
      if [[ -n "$conversation_id" ]]; then
        break
      fi
    else
      fail "start_task_failed"
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
fi

if [[ -z "$conversation_id" ]]; then
  fail "conversation_id_missing"
fi

if [[ -n "$PAYLOAD_FILE" ]]; then
  payload_response="$(curl_openhands GET "/api/v1/app-conversations?ids=${conversation_id}")"
  conversation_payload="$(extract_first_conversation "$payload_response")"
  if [[ -z "$conversation_payload" ]]; then
    fail "conversation_payload_missing"
  fi

  event_log_path="$(resolve_event_log_path "$conversation_payload" "$EVENT_LOG_PATH_TEMPLATE" "$conversation_id")"
  event_log_payload=""
  if [[ -n "$event_log_path" ]]; then
    event_log_payload="$(curl_openhands GET "$event_log_path")"
  fi
  write_payload_contract_file "$PAYLOAD_FILE" "$conversation_payload" "$event_log_payload"
fi

cat <<EOF
openhands_smoke=passed
mode=create_conversation
conversation_id=${conversation_id}
ui_url=$(url_join "$OPENHANDS_BASE_URL" "/conversations/${conversation_id}")
EOF

if [[ -n "$PAYLOAD_FILE" ]]; then
  printf 'payload_file=%s\n' "$PAYLOAD_FILE"
fi
