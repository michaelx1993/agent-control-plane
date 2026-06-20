#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

APPLY="${PLANE_LIVE_SMOKE_APPLY:-false}"
VERIFY_WEBHOOK="${PLANE_LIVE_SMOKE_VERIFY_WEBHOOK:-false}"
NEXT_STATE="${PLANE_LIVE_SMOKE_NEXT_STATE:-Development}"
CREATE_STATE="${PLANE_LIVE_SMOKE_CREATE_STATE:-Todo}"
SUMMARY="${PLANE_LIVE_SMOKE_SUMMARY:-Agent Control Plane live Plane smoke.}"
WEBHOOK_EVENT="${PLANE_LIVE_SMOKE_WEBHOOK_EVENT:-issue_comment.created}"

fail() {
  printf 'plane_live_smoke=failed\n' >&2
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
    rm -f "$tmp_file"
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
  printf '%s/%s' "${base%/}" "${path#/}"
}

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "$1"
}

html_escape() {
  node -e '
const value = process.argv[1] ?? "";
process.stdout.write(
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
);
' "$1"
}

curl_plane() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local body_file header_file status
  body_file="$(mktemp)"
  header_file="$(mktemp)"

  if [[ -n "$body" ]]; then
    status="$(
      curl -sS -D "$header_file" -o "$body_file" -w '%{http_code}' \
        -X "$method" \
        -H "X-API-Key: ${PLANE_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$body" \
        "$(url_join "$PLANE_BASE_URL" "$path")" || {
          cat "$body_file" >&2 || true
          rm -f "$body_file" "$header_file"
          fail "curl_error"
        }
    )"
  else
    status="$(
      curl -sS -D "$header_file" -o "$body_file" -w '%{http_code}' \
        -X "$method" \
        -H "X-API-Key: ${PLANE_API_KEY}" \
        -H "Content-Type: application/json" \
        "$(url_join "$PLANE_BASE_URL" "$path")" || {
          cat "$body_file" >&2 || true
          rm -f "$body_file" "$header_file"
          fail "curl_error"
        }
    )"
  fi

  if [[ "$status" != 2* ]]; then
    cat "$body_file" >&2 || true
    rm -f "$body_file" "$header_file"
    fail "plane_api_${status}"
  fi

  if grep -qiE '^(retry-after|x-ratelimit-limit|x-ratelimit-remaining|x-ratelimit-reset):' "$header_file"; then
    PLANE_LIVE_SMOKE_RATE_LIMIT_HEADERS_SEEN=true
  fi

  cat "$body_file"
  rm -f "$body_file" "$header_file"
}

collection_count() {
  JSON_INPUT="$1" node <<'NODE'
const raw = JSON.parse(process.env.JSON_INPUT ?? "[]");
const values = Array.isArray(raw) ? raw : Array.isArray(raw.results) ? raw.results : [];
process.stdout.write(String(values.length));
NODE
}

find_state_id() {
  STATES_JSON="$1" TARGET_STATE="$2" node <<'NODE'
const raw = JSON.parse(process.env.STATES_JSON ?? "[]");
const target = process.env.TARGET_STATE ?? "";
const states = Array.isArray(raw) ? raw : Array.isArray(raw.results) ? raw.results : [];
const state = states.find((candidate) => candidate?.name === target);
if (!state?.id) {
  process.exit(2);
}
process.stdout.write(String(state.id));
NODE
}

extract_id() {
  JSON_INPUT="$1" node <<'NODE'
const value = JSON.parse(process.env.JSON_INPUT ?? "{}");
const id = value.id ?? value.issue?.id ?? value.work_item?.id;
if (!id) {
  process.exit(2);
}
process.stdout.write(String(id));
NODE
}

verify_state_and_comment() {
  WORK_ITEM_JSON="$1" COMMENTS_JSON="$2" EXPECTED_STATE_ID="$3" EXPECTED_STATE="$4" EXPECTED_SUMMARY="$5" node <<'NODE'
const item = JSON.parse(process.env.WORK_ITEM_JSON ?? "{}");
const rawComments = JSON.parse(process.env.COMMENTS_JSON ?? "[]");
const comments = Array.isArray(rawComments)
  ? rawComments
  : Array.isArray(rawComments.results)
    ? rawComments.results
    : [];
const expectedStateId = process.env.EXPECTED_STATE_ID ?? "";
const expectedState = process.env.EXPECTED_STATE ?? "";
const expectedSummary = process.env.EXPECTED_SUMMARY ?? "";

function stateValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return String(value.id ?? value.name ?? "");
  return "";
}

const actualState = stateValue(item.state);
if (actualState !== expectedStateId && actualState !== expectedState) {
  console.error("plane_live_smoke=failed");
  console.error("error=state_verification_failed");
  process.exit(1);
}

const text = comments
  .map((comment) => String(comment.comment_stripped ?? comment.comment_html ?? comment.body ?? comment.comment ?? ""))
  .join("\n");
if (!text.includes(expectedState) || !text.includes(expectedSummary)) {
  console.error("plane_live_smoke=failed");
  console.error("error=comment_verification_failed");
  process.exit(1);
}
NODE
}

post_synthetic_webhook() {
  local work_item_id="$1"
  local body signature status response_file
  body="{\"issue\":{\"id\":$(json_string "$work_item_id")},\"comment_html\":$(json_string "$SUMMARY")}"
  signature="$(node -e '
const crypto = require("node:crypto");
process.stdout.write(crypto.createHmac("sha256", process.argv[1]).update(process.argv[2]).digest("hex"));
' "$PLANE_WEBHOOK_SECRET" "$body")"
  response_file="$(mktemp)"
  status="$(
    curl -sS -o "$response_file" -w '%{http_code}' \
      -X POST \
      -H "Content-Type: application/json" \
      -H "X-Plane-Event: ${WEBHOOK_EVENT}" \
      -H "X-Plane-Signature: sha256=${signature}" \
      -d "$body" \
      "$ACP_PLANE_WEBHOOK_URL" || {
        cat "$response_file" >&2 || true
        rm -f "$response_file"
        fail "webhook_curl_error"
      }
  )"

  if [[ "$status" != 2* ]]; then
    cat "$response_file" >&2 || true
    rm -f "$response_file"
    fail "webhook_${status}"
  fi

  rm -f "$response_file"
}

load_secret_env_file
load_secret_command

APPLY="${PLANE_LIVE_SMOKE_APPLY:-$APPLY}"
VERIFY_WEBHOOK="${PLANE_LIVE_SMOKE_VERIFY_WEBHOOK:-$VERIFY_WEBHOOK}"
NEXT_STATE="${PLANE_LIVE_SMOKE_NEXT_STATE:-$NEXT_STATE}"
CREATE_STATE="${PLANE_LIVE_SMOKE_CREATE_STATE:-$CREATE_STATE}"
SUMMARY="${PLANE_LIVE_SMOKE_SUMMARY:-$SUMMARY}"
WEBHOOK_EVENT="${PLANE_LIVE_SMOKE_WEBHOOK_EVENT:-$WEBHOOK_EVENT}"
PLANE_LIVE_SMOKE_RATE_LIMIT_HEADERS_SEEN=false

require_env "PLANE_BASE_URL"
require_env "PLANE_WORKSPACE_SLUG"
require_env "PLANE_PROJECT_ID"
require_env "PLANE_API_KEY"

states_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/states/")"
labels_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/labels/")"
items_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/issues/")"

states_count="$(collection_count "$states_json")"
labels_count="$(collection_count "$labels_json")"
items_count="$(collection_count "$items_json")"
next_state_id="$(find_state_id "$states_json" "$NEXT_STATE" || true)"
if [[ -z "$next_state_id" ]]; then
  fail "state_not_found:${NEXT_STATE}"
fi

work_item_id="${PLANE_LIVE_SMOKE_WORK_ITEM_ID:-}"
comment_verified=false
webhook_verified=false

if [[ "$APPLY" == "true" ]]; then
  create_state_id="$(find_state_id "$states_json" "$CREATE_STATE" || true)"
  title="ACP live smoke $(date -u +%Y%m%dT%H%M%SZ)"
  create_body="{\"name\":$(json_string "$title"),\"description_html\":$(json_string "<p>${SUMMARY}</p>")"
  if [[ -n "$create_state_id" ]]; then
    create_body="${create_body},\"state\":$(json_string "$create_state_id")"
  fi
  create_body="${create_body}}"
  created_json="$(curl_plane POST "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/issues/" "$create_body")"
  work_item_id="$(extract_id "$created_json")"

  state_body="{\"state\":$(json_string "$next_state_id")}"
  curl_plane PATCH \
    "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${work_item_id}/" \
    "$state_body" >/dev/null

  comment_html="<p><strong>Agent Status:</strong> Live Smoke</p><p><strong>Next State:</strong> $(html_escape "$NEXT_STATE")</p><p>$(html_escape "$SUMMARY")</p>"
  comment_body="{\"comment_html\":$(json_string "$comment_html"),\"external_source\":\"agent-control-plane\"}"
  curl_plane POST \
    "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${work_item_id}/comments/" \
    "$comment_body" >/dev/null

  work_item_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${work_item_id}/")"
  comments_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${work_item_id}/comments/")"
  verify_state_and_comment "$work_item_json" "$comments_json" "$next_state_id" "$NEXT_STATE" "$SUMMARY"
  comment_verified=true
fi

if [[ "$VERIFY_WEBHOOK" == "true" ]]; then
  require_env "ACP_PLANE_WEBHOOK_URL"
  require_env "PLANE_WEBHOOK_SECRET"
  if [[ -z "$work_item_id" ]]; then
    work_item_id="synthetic-plane-live-smoke"
  fi
  post_synthetic_webhook "$work_item_id"
  webhook_verified=true
fi

cat <<EOF
plane_live_smoke=passed
apply=${APPLY}
states=${states_count}
labels=${labels_count}
work_items=${items_count}
next_state=${NEXT_STATE}
next_state_id=${next_state_id}
created_work_item_id=${work_item_id}
comment_verified=${comment_verified}
webhook_verified=${webhook_verified}
rate_limit_headers_seen=${PLANE_LIVE_SMOKE_RATE_LIMIT_HEADERS_SEEN}
EOF
