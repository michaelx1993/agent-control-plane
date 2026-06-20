#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

REPORT_FILE="$TMP_DIR/nested/worker-codex-plane-report.json"
WORKER_JSON='{"workerId":"worker-smoke","claimed":[{"runId":"run-claim","taskId":"task-1","identifier":"TOKEN-99","role":"development","repositorySlug":"crs-src"}],"completed":[{"runId":"run-complete","taskId":"task-1","nextState":"Code Review"}],"failed":[]}'
DB_EVIDENCE=$'task_identifier=TOKEN-99\ntask_state=Code Review\ntask_url=https://plane.example/workspace/acme/projects/token/issues/TOKEN-99\nrepository_slug=crs-src\nrole=development\nrun_status=succeeded\nrun_next_state=Code Review\ncodex_events=7\nrunning_progress=1\nevent_progress=1\ncompleted_progress=1\nthread_reuse_events=2\napp_server_conversations=1'

node "$SCRIPT_DIR/write-worker-codex-plane-smoke-report.mjs" \
  "$REPORT_FILE" \
  "$WORKER_JSON" \
  "$DB_EVIDENCE" \
  "codex-app-server" \
  "https://control-plane.example" \
  "/srv/agent-worker" \
  "git-worktree" \
  "/tmp/workspaces" \
  "gpt-5.5" \
  "medium" \
  "true" \
  "false"

node - "$REPORT_FILE" <<'NODE'
import { readFileSync, statSync } from "node:fs";

const reportFile = process.argv[2];
const report = JSON.parse(readFileSync(reportFile, "utf8"));
const mode = (statSync(reportFile).mode & 0o777).toString(8);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(mode === "600", `report mode must be 600, got ${mode}`);
assert(report.status === "passed", "report status must be passed");
assert(report.smoke === "worker:codex-plane-smoke", "report smoke name mismatch");
assert(report.executionAdapter === "codex-app-server", "execution adapter mismatch");
assert(report.worker.workerId === "worker-smoke", "worker id mismatch");
assert(report.run.runId === "run-complete", "run id must prefer completed run id");
assert(report.run.taskId === "task-1", "task id mismatch");
assert(report.run.identifier === "TOKEN-99", "identifier mismatch");
assert(report.run.repositorySlug === "crs-src", "repository slug mismatch");
assert(report.codex.model === "gpt-5.5", "model mismatch");
assert(report.codex.reasoningEffort === "medium", "reasoning effort mismatch");
assert(report.codex.followUpRequired === true, "follow-up flag mismatch");
assert(report.workspace.strategy === "git-worktree", "workspace strategy mismatch");
assert(report.evidence.database.taskUrl.includes("/workspace/"), "Plane URL evidence missing");
assert(report.evidence.database.codexEvents === 7, "codex event count mismatch");
assert(report.evidence.database.threadReuseEvents === 2, "thread reuse count mismatch");
assert(report.evidence.database.appServerConversations === 1, "app-server conversation count mismatch");
assert(report.evidence.checks.claimedRuns === 1, "claimed run count mismatch");
assert(report.evidence.checks.completedRuns === 1, "completed run count mismatch");
assert(report.evidence.checks.failedRuns === 0, "failed run count mismatch");
NODE

if node "$SCRIPT_DIR/write-worker-codex-plane-smoke-report.mjs" \
  "$REPORT_FILE" \
  "$WORKER_JSON" \
  "$DB_EVIDENCE" \
  "codex-app-server" \
  "https://control-plane.example" \
  "/srv/agent-worker" \
  "git-worktree" \
  "/tmp/workspaces" \
  "gpt-5.5" \
  "medium" \
  "true" \
  "false" >/tmp/worker-plane-report-overwrite.out 2>&1; then
  echo "error=report overwrite unexpectedly passed" >&2
  exit 1
fi

if ! grep -q "report_file_exists" /tmp/worker-plane-report-overwrite.out; then
  echo "error=report overwrite failure did not mention report_file_exists" >&2
  cat /tmp/worker-plane-report-overwrite.out >&2
  exit 1
fi

node "$SCRIPT_DIR/write-worker-codex-plane-smoke-report.mjs" \
  "$REPORT_FILE" \
  "$WORKER_JSON" \
  "$DB_EVIDENCE" \
  "codex-app-server" \
  "https://control-plane.example" \
  "/srv/agent-worker" \
  "git-worktree" \
  "/tmp/workspaces" \
  "gpt-5.5" \
  "medium" \
  "true" \
  "true"

echo "worker_codex_plane_report_smoke=passed"
