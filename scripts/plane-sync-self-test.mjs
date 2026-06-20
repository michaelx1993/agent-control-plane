import assert from "node:assert/strict";
import { latestSyncCursor, readOptions } from "./plane-sync.mjs";

const options = readOptions({
  PLANE_SYNC_PROJECT_SLUG: "token",
  PLANE_SYNC_CURSOR: "2026-06-20T10:00:00.000Z",
  PLANE_SYNC_SERVER_DELTA: "false",
  PLANE_SYNC_RETRY_ATTEMPTS: "3",
  PLANE_SYNC_RETRY_DELAY_MS: "25",
});

assert.deepEqual(options, {
  projectSlug: "token",
  cursor: "2026-06-20T10:00:00.000Z",
  serverDelta: false,
  retryAttempts: 3,
  retryDelayMs: 25,
});

assert.equal(
  latestSyncCursor(
    [
      {
        externalTaskId: "issue-1",
        identifier: "TOK-1",
        title: "First",
        state: "Development",
        labels: [],
        priority: null,
        syncCursor: "2026-06-20T10:01:00.000Z",
      },
    ],
    [
      {
        externalTaskId: "issue-1",
        body: "Feedback",
        syncCursor: "2026-06-20T10:02:00.000Z",
      },
    ],
  ),
  "2026-06-20T10:02:00.000Z",
);

console.log("plane_sync_self_test=passed");
