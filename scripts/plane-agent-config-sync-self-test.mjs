import assert from "node:assert/strict";
import { normalizePlaneOutboxEvent, readOptions } from "./plane-agent-config-sync.mjs";

assert.deepEqual(
  readOptions({
    PLANE_AGENT_CONFIG_SYNC_CURSOR: "100",
    PLANE_AGENT_CONFIG_SYNC_LIMIT: "25",
    PLANE_SYNC_RETRY_ATTEMPTS: "3",
    PLANE_SYNC_RETRY_DELAY_MS: "0",
  }),
  {
    cursor: "100",
    limit: 25,
    retryAttempts: 3,
    retryDelayMs: 0,
  },
);

assert.deepEqual(
  normalizePlaneOutboxEvent("workspace-default", {
    id: 101,
    workspace_id: "workspace-1",
    entity_type: "agent_user_agent",
    entity_id: "agent-1",
    operation: "create",
    projection_version: 2,
    payload: {
      owner: "user-1",
      name: "Codex",
      model: "gpt-5-codex",
    },
  }),
  {
    planeWorkspaceId: "workspace-1",
    planeOutboxId: 101,
    entityType: "agent_user_agent",
    entityId: "agent-1",
    operation: "create",
    projectionVersion: 2,
    payload: {
      owner: "user-1",
      name: "Codex",
      model: "gpt-5-codex",
    },
  },
);

assert.deepEqual(
  normalizePlaneOutboxEvent("workspace-default", {
    id: 102,
    entity_type: "agent_repository",
    entity_id: "repo-1",
    projection_version: 1,
    payload: {
      key: "plane",
      provider: "github",
      name: "plane",
      url: "git@github.com:michaelx1993/plane.git",
    },
  }).entityType,
  "agent_repository",
);

assert.deepEqual(
  normalizePlaneOutboxEvent("workspace-default", {
    id: 103,
    entity_type: "agent_user_secret_key",
    entity_id: "secret-key-1",
    projection_version: 1,
    payload: {
      owner: "user-1",
      key: "GITHUB_TOKEN",
      provider: "env",
    },
  }).entityType,
  "agent_user_secret_key",
);

assert.throws(
  () =>
    normalizePlaneOutboxEvent("workspace-default", {
      id: 101,
      entity_type: "unsupported",
      entity_id: "entity-1",
      projection_version: 2,
      payload: {},
    }),
  /Unsupported Plane agent config outbox entity type/,
);

console.log("plane_agent_config_sync_self_test=passed");
