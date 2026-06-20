#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PORT_FILE="$TMP_DIR/port"
LOG_FILE="$TMP_DIR/server.log"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

node - "$PORT_FILE" <<'NODE' >"$LOG_FILE" 2>&1 &
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");

const portFile = process.argv[2];
const workspace = "workspace";
const project = "project";
const webhookSecret = "plane-live-smoke-secret";
const states = [
  { id: "state-todo", name: "Todo" },
  { id: "state-development", name: "Development" },
];
const labels = [{ id: "label-repo", name: "repo:smoke" }];
const items = new Map([
  ["seed-item", { id: "seed-item", name: "Seed item", state: "state-todo", labels: ["label-repo"] }],
]);
const comments = new Map();

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-RateLimit-Limit": "60",
    "X-RateLimit-Remaining": "59",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

function verifyWebhook(req, body) {
  const signature = String(req.headers["x-plane-signature"] ?? "").replace(/^sha256=/i, "");
  const expected = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
  return signature === expected;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = url.pathname;
  const base = `/api/v1/workspaces/${workspace}/projects/${project}`;

  if (path === "/webhook" && req.method === "POST") {
    const body = await readBody(req);
    if (!verifyWebhook(req, body)) {
      sendJson(res, 401, { accepted: false, skippedReason: "invalid_signature" });
      return;
    }
    sendJson(res, 200, { accepted: true, eventName: req.headers["x-plane-event"] });
    return;
  }

  if (req.headers["x-api-key"] !== "test-api-key") {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (path === `${base}/states/` && req.method === "GET") {
    sendJson(res, 200, { results: states });
    return;
  }

  if (path === `${base}/labels/` && req.method === "GET") {
    sendJson(res, 200, { results: labels });
    return;
  }

  if (path === `${base}/issues/` && req.method === "GET") {
    sendJson(res, 200, { results: Array.from(items.values()) });
    return;
  }

  if (path === `${base}/issues/` && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    const id = `created-${items.size + 1}`;
    const item = { id, name: String(body.name), state: String(body.state ?? "state-todo"), labels: [] };
    items.set(id, item);
    sendJson(res, 201, item);
    return;
  }

  const workItemMatch = path.match(new RegExp(`^${base}/work-items/([^/]+)/$`));
  if (workItemMatch && req.method === "GET") {
    const item = items.get(workItemMatch[1]);
    sendJson(res, item ? 200 : 404, item ?? { error: "not_found" });
    return;
  }

  if (workItemMatch && req.method === "PATCH") {
    const item = items.get(workItemMatch[1]);
    if (!item) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const body = JSON.parse(await readBody(req));
    item.state = String(body.state);
    sendJson(res, 200, item);
    return;
  }

  const commentsMatch = path.match(new RegExp(`^${base}/work-items/([^/]+)/comments/$`));
  if (commentsMatch && req.method === "GET") {
    sendJson(res, 200, { results: comments.get(commentsMatch[1]) ?? [] });
    return;
  }

  if (commentsMatch && req.method === "POST") {
    const body = JSON.parse(await readBody(req));
    const list = comments.get(commentsMatch[1]) ?? [];
    const comment = {
      id: `comment-${list.length + 1}`,
      comment_html: String(body.comment_html ?? ""),
      comment_stripped: String(body.comment_html ?? "").replace(/<[^>]+>/g, " "),
    };
    list.push(comment);
    comments.set(commentsMatch[1], list);
    sendJson(res, 201, comment);
    return;
  }

  sendJson(res, 404, { error: "not_found", path });
});

server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port));
});
NODE
SERVER_PID=$!

for _ in {1..50}; do
  if [[ -f "$PORT_FILE" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -f "$PORT_FILE" ]]; then
  cat "$LOG_FILE" >&2 || true
  echo "plane_live_smoke_self_test=failed" >&2
  echo "error=server_not_ready" >&2
  exit 1
fi

PORT="$(cat "$PORT_FILE")"

PLANE_BASE_URL="http://127.0.0.1:${PORT}" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="test-api-key" \
PLANE_WEBHOOK_SECRET="plane-live-smoke-secret" \
ACP_PLANE_WEBHOOK_URL="http://127.0.0.1:${PORT}/webhook" \
PLANE_LIVE_SMOKE_APPLY=true \
PLANE_LIVE_SMOKE_VERIFY_WEBHOOK=true \
PLANE_LIVE_SMOKE_SUMMARY="Agent Control Plane live smoke self-test." \
bash "$ROOT_DIR/scripts/smoke-plane-live.sh" | tee "$TMP_DIR/output"

grep -q '^plane_live_smoke=passed$' "$TMP_DIR/output"
grep -q '^apply=true$' "$TMP_DIR/output"
grep -q '^comment_verified=true$' "$TMP_DIR/output"
grep -q '^webhook_verified=true$' "$TMP_DIR/output"
grep -q '^rate_limit_headers_seen=true$' "$TMP_DIR/output"

echo "plane_live_smoke_self_test=passed"
