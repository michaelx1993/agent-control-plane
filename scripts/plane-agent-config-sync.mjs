export async function runPlaneAgentConfigSyncCli(env = process.env) {
  const db = await import("../packages/db/dist/index.js");
  const plane = await import("../packages/plane/dist/index.js");
  const config = loadPlaneConfig(env);
  const options = readOptions(env);

  return db.withDatabasePool((pool) =>
    db.withTransaction(pool, async (transaction) => {
      const previousCursor =
        options.cursor ??
        (await db.getPlaneAgentConfigOutboxCursor(transaction, config.workspaceSlug));
      const events = await plane.fetchPlaneAgentConfigOutboxEvents(config, undefined, {
        ...(previousCursor !== undefined ? { afterId: previousCursor } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.retryAttempts !== undefined ? { retryAttempts: options.retryAttempts } : {}),
        ...(options.retryDelayMs !== undefined ? { retryDelayMs: options.retryDelayMs } : {}),
      });

      let applied = 0;
      let skipped = 0;

      for (const event of events) {
        const result = await db.applyPlaneProjectionEvent(
          transaction,
          normalizePlaneOutboxEvent(config.workspaceSlug, event),
        );
        if (result.status === "applied") {
          applied += 1;
        } else {
          skipped += 1;
        }
      }

      const nextCursor = db.latestPlaneOutboxCursor(previousCursor, events);
      await db.updatePlaneAgentConfigOutboxCursor(transaction, {
        planeWorkspaceId: config.workspaceSlug,
        cursor: nextCursor,
      });

      return {
        planeWorkspaceId: config.workspaceSlug,
        fetched: events.length,
        applied,
        skipped,
        ...(previousCursor ? { previousCursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
      };
    }),
  );
}

function loadPlaneConfig(env) {
  return {
    baseUrl: requireEnv(env, "PLANE_BASE_URL").replace(/\/+$/, ""),
    apiKey: requireEnv(env, "PLANE_API_KEY"),
    workspaceSlug: requireEnv(env, "PLANE_WORKSPACE_SLUG"),
  };
}

export function readOptions(env) {
  return {
    ...(env.PLANE_AGENT_CONFIG_SYNC_CURSOR?.trim()
      ? { cursor: env.PLANE_AGENT_CONFIG_SYNC_CURSOR.trim() }
      : {}),
    ...positiveIntegerOption("limit", env.PLANE_AGENT_CONFIG_SYNC_LIMIT),
    ...positiveIntegerOption("retryAttempts", env.PLANE_SYNC_RETRY_ATTEMPTS),
    ...nonNegativeIntegerOption("retryDelayMs", env.PLANE_SYNC_RETRY_DELAY_MS),
  };
}

export function normalizePlaneOutboxEvent(defaultWorkspaceId, event) {
  const entityType = normalizeEntityType(event.entity_type);
  return {
    planeWorkspaceId: String(event.workspace_id ?? defaultWorkspaceId),
    planeOutboxId: event.id,
    entityType,
    entityId: requiredString(event, "entity_id"),
    projectionVersion: event.projection_version,
    payload: objectValue(event, "payload"),
  };
}

function normalizeEntityType(value) {
  switch (value) {
    case "project_workspace":
    case "user_agent":
    case "prompt":
    case "prompt_version":
    case "prompt_binding":
    case "worker_card":
      return value;
    default:
      throw new Error(`Unsupported Plane agent config outbox entity type: ${value}`);
  }
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function requiredString(record, key) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Plane outbox event requires non-empty string field: ${key}`);
  }
  return value;
}

function objectValue(record, key) {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Plane outbox event requires object field: ${key}`);
  }
  return value;
}

function positiveIntegerOption(key, value) {
  if (!value) {
    return {};
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? { [key]: parsed } : {};
}

function nonNegativeIntegerOption(key, value) {
  if (!value) {
    return {};
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? { [key]: parsed } : {};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPlaneAgentConfigSyncCli()
    .then((summary) => {
      console.log("plane_agent_config_sync=passed");
      console.log(`plane_workspace_id=${summary.planeWorkspaceId}`);
      console.log(`fetched=${summary.fetched}`);
      console.log(`applied=${summary.applied}`);
      console.log(`skipped=${summary.skipped}`);
      if (summary.nextCursor) {
        console.log(`next_cursor=${summary.nextCursor}`);
      }
    })
    .catch((error) => {
      console.error("plane_agent_config_sync=failed");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
