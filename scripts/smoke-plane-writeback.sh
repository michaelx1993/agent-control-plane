#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secret-env.sh
source "$SCRIPT_DIR/lib/secret-env.sh"

BASE_URL="${PLANE_BASE_URL:-}"
WORKSPACE_SLUG="${PLANE_WORKSPACE_SLUG:-}"
PROJECT_ID="${PLANE_PROJECT_ID:-}"
API_KEY="${PLANE_API_KEY:-}"
WORK_ITEM_ID="${PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID:-}"
NEXT_STATE="${PLANE_WRITEBACK_SMOKE_NEXT_STATE:-Development}"
STATUS="${PLANE_WRITEBACK_SMOKE_STATUS:-Smoke Check}"
SUMMARY="${PLANE_WRITEBACK_SMOKE_SUMMARY:-Agent Control Plane Plane writeback smoke.}"
APPLY="${PLANE_WRITEBACK_SMOKE_APPLY:-false}"
VERIFY_COMMENTS="${PLANE_WRITEBACK_SMOKE_VERIFY_COMMENTS:-false}"

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

fail() {
  printf 'plane_writeback_smoke=failed\n' >&2
  printf 'error=%s\n' "$1" >&2
  exit 1
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

curl_plane() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local body_file status
  body_file="$(mktemp)"

  if [[ -n "$body" ]]; then
    status="$(
      curl -sS -o "$body_file" -w '%{http_code}' \
        -X "$method" \
        -H "X-API-Key: ${PLANE_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$body" \
        "$(url_join "$PLANE_BASE_URL" "$path")" || {
          cat "$body_file" >&2 || true
          rm -f "$body_file"
          fail "curl_error"
        }
    )"
  else
    status="$(
      curl -sS -o "$body_file" -w '%{http_code}' \
        -X "$method" \
        -H "X-API-Key: ${PLANE_API_KEY}" \
        -H "Content-Type: application/json" \
        "$(url_join "$PLANE_BASE_URL" "$path")" || {
          cat "$body_file" >&2 || true
          rm -f "$body_file"
          fail "curl_error"
        }
    )"
  fi

  if [[ "$status" != 2* ]]; then
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    fail "plane_api_${status}"
  fi

  cat "$body_file"
  rm -f "$body_file"
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

find_state_id() {
  STATES_JSON="$1" node - "$NEXT_STATE" <<'NODE'
const target = process.argv[2];
const raw = process.env.STATES_JSON ?? "";
const parsed = JSON.parse(raw);
const states = Array.isArray(parsed) ? parsed : Array.isArray(parsed.results) ? parsed.results : [];
const state = states.find((candidate) => candidate && candidate.name === target);
if (!state?.id) {
  process.exit(2);
}
process.stdout.write(String(state.id));
NODE
}

verify_writeback() {
  WORK_ITEM_JSON="$1" COMMENTS_JSON="$2" EXPECTED_STATE_ID="$3" EXPECTED_STATUS="$4" EXPECTED_STATE="$5" EXPECTED_SUMMARY="$6" node <<'NODE'
const item = JSON.parse(process.env.WORK_ITEM_JSON ?? "{}");
const commentsRaw = JSON.parse(process.env.COMMENTS_JSON ?? "[]");
const comments = Array.isArray(commentsRaw)
  ? commentsRaw
  : Array.isArray(commentsRaw.results)
    ? commentsRaw.results
    : [];

const expectedStateId = process.env.EXPECTED_STATE_ID ?? "";
const expectedStatus = process.env.EXPECTED_STATUS ?? "";
const expectedState = process.env.EXPECTED_STATE ?? "";
const expectedSummary = process.env.EXPECTED_SUMMARY ?? "";

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stateValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return String(value.id ?? value.name ?? "");
  }
  return "";
}

const actualState = stateValue(item.state);
if (actualState !== expectedStateId && actualState !== expectedState) {
  console.error("plane_writeback_smoke=failed");
  console.error("error=state_verification_failed");
  process.exit(1);
}

const commentText = comments
  .map((comment) =>
    String(comment.comment_stripped ?? comment.comment_html ?? comment.body ?? comment.comment ?? ""),
  )
  .join("\n");

if (
  !commentText.includes(expectedStatus) ||
  !commentText.includes(expectedState) ||
  (!commentText.includes(expectedSummary) && !commentText.includes(escapeHtml(expectedSummary)))
) {
  console.error("plane_writeback_smoke=failed");
  console.error("error=comment_verification_failed");
  process.exit(1);
}
NODE
}

count_comments() {
  COMMENTS_JSON="$1" node <<'NODE'
const raw = JSON.parse(process.env.COMMENTS_JSON ?? "[]");
const comments = Array.isArray(raw) ? raw : Array.isArray(raw.results) ? raw.results : [];
process.stdout.write(String(comments.length));
NODE
}

load_secret_env_file
load_secret_command

BASE_URL="${PLANE_BASE_URL:-$BASE_URL}"
WORKSPACE_SLUG="${PLANE_WORKSPACE_SLUG:-$WORKSPACE_SLUG}"
PROJECT_ID="${PLANE_PROJECT_ID:-$PROJECT_ID}"
API_KEY="${PLANE_API_KEY:-$API_KEY}"
WORK_ITEM_ID="${PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID:-$WORK_ITEM_ID}"
NEXT_STATE="${PLANE_WRITEBACK_SMOKE_NEXT_STATE:-$NEXT_STATE}"
STATUS="${PLANE_WRITEBACK_SMOKE_STATUS:-$STATUS}"
SUMMARY="${PLANE_WRITEBACK_SMOKE_SUMMARY:-$SUMMARY}"
APPLY="${PLANE_WRITEBACK_SMOKE_APPLY:-$APPLY}"
VERIFY_COMMENTS="${PLANE_WRITEBACK_SMOKE_VERIFY_COMMENTS:-$VERIFY_COMMENTS}"

require_env "PLANE_BASE_URL"
require_env "PLANE_WORKSPACE_SLUG"
require_env "PLANE_PROJECT_ID"
require_env "PLANE_API_KEY"

states_path="/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/states/"
states_json="$(curl_plane GET "$states_path")"
if ! state_id="$(find_state_id "$states_json")"; then
  fail "state_not_found:${NEXT_STATE}"
fi

if [[ "$APPLY" != "true" ]]; then
  comments_line=""
  if [[ "$VERIFY_COMMENTS" == "true" ]]; then
    if [[ -z "$WORK_ITEM_ID" ]]; then
      fail "PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID_missing"
    fi
    comments_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${WORK_ITEM_ID}/comments/")"
    comments_count="$(count_comments "$comments_json")"
    comments_line="comments=verified
comment_count=${comments_count}"
  fi
  cat <<EOF
plane_writeback_smoke=passed
apply=false
state=${NEXT_STATE}
state_id=${state_id}
${comments_line}
EOF
  exit 0
fi

if [[ -z "$WORK_ITEM_ID" ]]; then
  fail "PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID_missing"
fi

state_body="{\"state\":$(json_string "$state_id")}"
curl_plane PATCH \
  "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${WORK_ITEM_ID}/" \
  "$state_body" >/dev/null

comment_html="<p><strong>Agent Status:</strong> $(html_escape "$STATUS")</p><p><strong>Next State:</strong> $(html_escape "$NEXT_STATE")</p><p>$(html_escape "$SUMMARY")</p>"
comment_body="{\"comment_html\":$(json_string "$comment_html"),\"external_source\":\"agent-control-plane\"}"
curl_plane POST \
  "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${WORK_ITEM_ID}/comments/" \
  "$comment_body" >/dev/null

work_item_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${WORK_ITEM_ID}/")"
comments_json="$(curl_plane GET "/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/work-items/${WORK_ITEM_ID}/comments/")"
verify_writeback "$work_item_json" "$comments_json" "$state_id" "$STATUS" "$NEXT_STATE" "$SUMMARY"

cat <<EOF
plane_writeback_smoke=passed
apply=true
work_item_id=${WORK_ITEM_ID}
state=${NEXT_STATE}
state_id=${state_id}
comment=created
verified=true
EOF
