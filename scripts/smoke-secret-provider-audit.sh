#!/usr/bin/env bash
set -euo pipefail

AUDIT_FILE="${SECRET_PROVIDER_AUDIT_FILE:-}"
AUDIT_COMMAND="${SECRET_PROVIDER_AUDIT_COMMAND:-}"
EVENT_PATTERN="${SECRET_PROVIDER_AUDIT_EVENT_PATTERN:-rotat|secret_rotation}"
SINCE="${SECRET_PROVIDER_AUDIT_SINCE:-}"
AUDIT_SOURCE="file"
TMP_AUDIT_FILE=""
TMP_AUDIT_STDERR=""

cleanup() {
  if [[ -n "$TMP_AUDIT_FILE" && -f "$TMP_AUDIT_FILE" ]]; then
    rm -f "$TMP_AUDIT_FILE"
  fi
  if [[ -n "$TMP_AUDIT_STDERR" && -f "$TMP_AUDIT_STDERR" ]]; then
    rm -f "$TMP_AUDIT_STDERR"
  fi
}
trap cleanup EXIT

if [[ -n "$AUDIT_FILE" && -n "$AUDIT_COMMAND" ]]; then
  echo "secret_provider_audit_smoke=failed" >&2
  echo "error: set only one of SECRET_PROVIDER_AUDIT_FILE or SECRET_PROVIDER_AUDIT_COMMAND" >&2
  exit 1
fi

if [[ -z "$AUDIT_FILE" && -z "$AUDIT_COMMAND" ]]; then
  echo "secret_provider_audit_smoke=failed" >&2
  echo "error: SECRET_PROVIDER_AUDIT_FILE or SECRET_PROVIDER_AUDIT_COMMAND is required" >&2
  exit 1
fi

if [[ -n "$AUDIT_COMMAND" ]]; then
  AUDIT_SOURCE="command"
  TMP_AUDIT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-provider-audit.XXXXXX")"
  TMP_AUDIT_STDERR="$(mktemp "${TMPDIR:-/tmp}/acp-provider-audit-stderr.XXXXXX")"
  chmod 600 "$TMP_AUDIT_FILE"
  if ! bash -c "$AUDIT_COMMAND" >"$TMP_AUDIT_FILE" 2>"$TMP_AUDIT_STDERR"; then
    echo "secret_provider_audit_smoke=failed" >&2
    echo "error: SECRET_PROVIDER_AUDIT_COMMAND failed" >&2
    exit 1
  fi
  AUDIT_FILE="$TMP_AUDIT_FILE"
fi

if [[ ! -f "$AUDIT_FILE" ]]; then
  echo "secret_provider_audit_smoke=failed" >&2
  echo "error: SECRET_PROVIDER_AUDIT_FILE not found" >&2
  exit 1
fi

mode="$(stat -f '%Lp' "$AUDIT_FILE" 2>/dev/null || stat -c '%a' "$AUDIT_FILE" 2>/dev/null || printf '')"
if [[ "$mode" != "600" && "$mode" != "400" ]]; then
  echo "secret_provider_audit_smoke=failed" >&2
  echo "error: SECRET_PROVIDER_AUDIT_FILE permissions must be 600 or 400" >&2
  exit 1
fi

if [[ ! -s "$AUDIT_FILE" ]]; then
  echo "secret_provider_audit_smoke=failed" >&2
  echo "error: SECRET_PROVIDER_AUDIT_FILE is empty" >&2
  exit 1
fi

current_secret_values() {
  env | awk -F= '
    /(_SECRET|_TOKEN|_API_KEY|_PASSWORD)=/ {
      value = substr($0, index($0, "=") + 1)
      if (length(value) >= 12) {
        print value
      }
    }
  '
}

while IFS= read -r secret_value; do
  if [[ -n "$secret_value" ]] && grep -F -q -- "$secret_value" "$AUDIT_FILE"; then
    echo "secret_provider_audit_smoke=failed" >&2
    echo "error: audit file contains a current secret value" >&2
    exit 1
  fi
done < <(current_secret_values)

if grep -E -q -- '-----BEGIN ((RSA|EC|OPENSSH) )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{16,}' "$AUDIT_FILE"; then
  echo "secret_provider_audit_smoke=failed" >&2
  echo "error: audit file contains a private-key or API-key shaped value" >&2
  exit 1
fi

node - "$AUDIT_FILE" "$EVENT_PATTERN" "$SINCE" <<'NODE'
const fs = require("fs");

const [file, eventPattern, sinceRaw] = process.argv.slice(2);
const pattern = new RegExp(eventPattern, "i");
const since = sinceRaw ? Date.parse(sinceRaw) : undefined;
if (sinceRaw && Number.isNaN(since)) {
  console.error("secret_provider_audit_smoke=failed");
  console.error("error: SECRET_PROVIDER_AUDIT_SINCE is not a valid timestamp");
  process.exit(1);
}

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim());
let parsed = 0;
let matched = 0;
let newest = "";

for (const line of lines) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    console.error("secret_provider_audit_smoke=failed");
    console.error("error: audit file must be JSONL");
    process.exit(1);
  }

  parsed += 1;
  const text = JSON.stringify(event);
  const timestampValue =
    event.created_at ?? event.createdAt ?? event.timestamp ?? event.time ?? event.rotated_at;
  const timestamp = typeof timestampValue === "string" ? Date.parse(timestampValue) : undefined;
  if (Number.isFinite(timestamp) && (!newest || timestamp > Date.parse(newest))) {
    newest = new Date(timestamp).toISOString();
  }

  if (pattern.test(text) && (since === undefined || (Number.isFinite(timestamp) && timestamp >= since))) {
    matched += 1;
  }
}

if (parsed === 0) {
  console.error("secret_provider_audit_smoke=failed");
  console.error("error: audit file contains no events");
  process.exit(1);
}

if (matched === 0) {
  console.error("secret_provider_audit_smoke=failed");
  console.error("error: audit file contains no matching rotation events");
  process.exit(1);
}

console.log("secret_provider_audit_smoke=passed");
console.log(`source=${process.env.SECRET_PROVIDER_AUDIT_COMMAND ? "command" : "file"}`);
console.log(`events=${parsed}`);
console.log(`matched_events=${matched}`);
if (newest) {
  console.log(`newest_event_at=${newest}`);
}
NODE
