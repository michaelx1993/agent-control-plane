#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-linear-migration.XXXXXX")"
PORT_FILE="$TMP_DIR/port"
EXPORT_FILE="$TMP_DIR/linear-export.json"
DRY_OUTPUT="$TMP_DIR/dry-run.out"
APPLY_OUTPUT="$TMP_DIR/apply.out"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cat >"$EXPORT_FILE" <<'JSON'
{
  "data": {
    "issues": {
      "nodes": [
        {
          "id": "linear-active-1",
          "identifier": "TOK-101",
          "title": "Migrate active task",
          "description": "Keep original context.\nUse Plane after cutover.",
          "url": "https://linear.app/bob/issue/TOK-101/migrate-active-task",
          "priority": 2,
          "state": { "name": "Development" },
          "labels": { "nodes": [{ "name": "repo:crs-src" }, { "name": "Feature" }] },
          "updatedAt": "2026-06-19T12:00:00.000Z"
        },
        {
          "id": "linear-active-2",
          "identifier": "TOK-102",
          "title": "Migrate task with missing label",
          "description": "This validates missing label reporting.",
          "url": "https://linear.app/bob/issue/TOK-102/missing-label",
          "priority": 3,
          "state": "Todo",
          "labels": ["repo:sub2", "Needs Mapping"]
        },
        {
          "id": "linear-done-1",
          "identifier": "TOK-103",
          "title": "Already done",
          "state": "Done",
          "labels": []
        }
      ]
    }
  }
}
JSON

node - "$PORT_FILE" <<'NODE' &
const http = require("node:http");
const fs = require("node:fs");
const portFile = process.argv[2];

const state = {
  labels: [
    { id: "label-crs", name: "repo:crs-src" },
    { id: "label-feature", name: "Feature" },
    { id: "label-sub2", name: "repo:sub2" },
  ],
  states: [
    { id: "state-todo", name: "Todo" },
    { id: "state-development", name: "Development" },
  ],
  created: [],
};

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
  });
}

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");

  if (url.pathname === "/__created" && request.method === "GET") {
    send(response, 200, state.created);
    return;
  }

  if (url.pathname.endsWith("/labels/") && request.method === "GET") {
    send(response, 200, { results: state.labels });
    return;
  }

  if (url.pathname.endsWith("/states/") && request.method === "GET") {
    send(response, 200, state.states);
    return;
  }

  if (url.pathname.endsWith("/issues/") && request.method === "POST") {
    const body = JSON.parse((await readBody(request)) || "{}");
    const created = {
      id: `created-${state.created.length + 1}`,
      name: body.name,
      state: body.state ?? null,
      labels: body.labels ?? [],
      priority: body.priority ?? null,
      description_html: body.description_html ?? "",
    };
    state.created.push(created);
    send(response, 201, created);
    return;
  }

  send(response, 404, { error: "not_found", path: url.pathname, method: request.method });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock server did not expose a port");
  }
  fs.writeFileSync(portFile, String(address.port));
});
NODE
SERVER_PID="$!"

for _ in $(seq 1 50); do
  if [[ -s "$PORT_FILE" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -s "$PORT_FILE" ]]; then
  echo "linear_migration_smoke=failed" >&2
  echo "error=mock_plane_not_ready" >&2
  exit 1
fi

BASE_URL="http://127.0.0.1:$(cat "$PORT_FILE")"

run_migration() {
  local output_file="$1"
  local apply="$2"
  shift
  shift
  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    LINEAR_EXPORT_PATH="$EXPORT_FILE" \
    LINEAR_MIGRATION_APPLY="$apply" \
    PLANE_BASE_URL="$BASE_URL" \
    PLANE_API_KEY="plane-key-fixture" \
    PLANE_WORKSPACE_SLUG="workspace" \
    PLANE_PROJECT_ID="project" \
    PLANE_PROJECT_SLUG="token" \
    "$@" >"$output_file"
}

run_migration "$DRY_OUTPUT" false pnpm --silent linear:migrate

node - "$DRY_OUTPUT" <<'NODE'
const fs = require("node:fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
const match = raw.match(/\{[\s\S]*?\}/);
if (!match) throw new Error("dry-run summary JSON missing");
const summary = JSON.parse(match[0]);
if (summary.apply !== false) throw new Error("dry-run must report apply=false");
if (summary.planned !== 2) throw new Error(`expected 2 planned, got ${summary.planned}`);
if (summary.created !== 0) throw new Error(`expected 0 created, got ${summary.created}`);
if (summary.skipped !== 1) throw new Error(`expected 1 skipped, got ${summary.skipped}`);
if (summary.missingLabelCandidates !== 1) {
  throw new Error(`expected 1 missing label candidate, got ${summary.missingLabelCandidates}`);
}
NODE

created_before="$(curl -sS "$BASE_URL/__created")"
node - "$created_before" <<'NODE'
const created = JSON.parse(process.argv[2]);
if (!Array.isArray(created) || created.length !== 0) {
  throw new Error("dry-run created Plane work items");
}
NODE

run_migration "$APPLY_OUTPUT" true pnpm --silent linear:migrate

node - "$APPLY_OUTPUT" <<'NODE'
const fs = require("node:fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
const match = raw.match(/\{[\s\S]*?\}/);
if (!match) throw new Error("apply summary JSON missing");
const summary = JSON.parse(match[0]);
if (summary.apply !== true) throw new Error("apply must report apply=true");
if (summary.planned !== 2) throw new Error(`expected 2 planned, got ${summary.planned}`);
if (summary.created !== 2) throw new Error(`expected 2 created, got ${summary.created}`);
if (summary.skipped !== 1) throw new Error(`expected 1 skipped, got ${summary.skipped}`);
if (summary.missingLabelCandidates !== 1) {
  throw new Error(`expected 1 missing label candidate, got ${summary.missingLabelCandidates}`);
}
NODE

created_after="$(curl -sS "$BASE_URL/__created")"
node - "$created_after" <<'NODE'
const created = JSON.parse(process.argv[2]);
if (!Array.isArray(created) || created.length !== 2) {
  throw new Error(`expected 2 created work items, got ${Array.isArray(created) ? created.length : "non-array"}`);
}

const active = created.find((item) => item.name === "Migrate active task");
if (!active) throw new Error("active task was not created");
if (active.state !== "state-development") throw new Error(`bad state mapping: ${active.state}`);
if (active.priority !== "high") throw new Error(`bad priority mapping: ${active.priority}`);
if (!Array.isArray(active.labels) || active.labels.join(",") !== "label-crs,label-feature") {
  throw new Error(`bad label mapping: ${JSON.stringify(active.labels)}`);
}
if (!String(active.description_html).includes("TOK-101")) {
  throw new Error("description does not preserve original identifier");
}
if (!String(active.description_html).includes("https://linear.app/bob/issue/TOK-101/migrate-active-task")) {
  throw new Error("description does not preserve Linear URL");
}

const missingLabel = created.find((item) => item.name === "Migrate task with missing label");
if (!missingLabel) throw new Error("missing-label task was not created");
if (missingLabel.state !== "state-todo") throw new Error(`bad todo state mapping: ${missingLabel.state}`);
if (!Array.isArray(missingLabel.labels) || missingLabel.labels.join(",") !== "label-sub2") {
  throw new Error(`missing-label task should only include resolved labels: ${JSON.stringify(missingLabel.labels)}`);
}
NODE

echo "linear_migration_smoke=passed"
echo "dry_run_verified=true"
echo "apply_verified=true"
echo "terminal_skip_verified=true"
echo "description_provenance_verified=true"
echo "missing_label_reporting_verified=true"
