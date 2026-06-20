export async function runPlaneSyncCli(env = process.env) {
  const db = await import("../packages/db/dist/index.js");
  const plane = await import("../packages/plane/dist/index.js");
  const config = loadPlaneConfig(env);
  const options = readOptions(env);
  const projectSlug = options.projectSlug ?? config.projectSlug;

  return db.withDatabasePool((pool) =>
    db.withTransaction(pool, async (transaction) => {
      const previousCursor =
        options.cursor ?? (await db.getPlaneProjectSyncCursor(transaction, projectSlug));
      const records = await plane.fetchPlaneTaskAndCommentSyncRecords(config, undefined, {
        syncCursor: previousCursor,
        serverDelta: options.serverDelta ?? true,
        ...(options.retryAttempts !== undefined ? { retryAttempts: options.retryAttempts } : {}),
        ...(options.retryDelayMs !== undefined ? { retryDelayMs: options.retryDelayMs } : {}),
      });

      const taskResult = await db.syncExternalTasks(transaction, {
        projectSlug,
        tasks: records.tasks,
      });
      const commentsInserted = await insertPlaneComments(
        db.insertPlaneCommentFeedback,
        transaction,
        records.comments,
      );
      const nextCursor = latestSyncCursor(records.tasks, records.comments) ?? previousCursor;

      await db.updatePlaneProjectSyncCursor(transaction, {
        projectSlug,
        syncCursor: nextCursor,
      });

      return {
        projectSlug,
        fetchedTasks: records.tasks.length,
        upserted: taskResult.upserted,
        routed: taskResult.routed,
        unrouted: taskResult.unrouted,
        commentsFetched: records.comments.length,
        commentsInserted,
        warnings: records.warnings,
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
    projectId: requireEnv(env, "PLANE_PROJECT_ID"),
    projectSlug: env.PLANE_PROJECT_SLUG?.trim() || "token",
  };
}

export function readOptions(env) {
  return {
    ...(env.PLANE_SYNC_PROJECT_SLUG?.trim()
      ? { projectSlug: env.PLANE_SYNC_PROJECT_SLUG.trim() }
      : {}),
    ...(env.PLANE_SYNC_CURSOR?.trim() ? { cursor: env.PLANE_SYNC_CURSOR.trim() } : {}),
    serverDelta: env.PLANE_SYNC_SERVER_DELTA === "false" ? false : true,
    ...positiveIntegerOption("retryAttempts", env.PLANE_SYNC_RETRY_ATTEMPTS),
    ...nonNegativeIntegerOption("retryDelayMs", env.PLANE_SYNC_RETRY_DELAY_MS),
  };
}

export function latestSyncCursor(tasks, comments) {
  return [...tasks, ...comments]
    .map((record) => record.syncCursor)
    .filter((cursor) => Boolean(cursor))
    .sort()
    .at(-1);
}

async function insertPlaneComments(insertPlaneCommentFeedback, client, comments) {
  let inserted = 0;

  for (const comment of comments) {
    const result = await insertPlaneCommentFeedback(client, {
      externalTaskId: comment.externalTaskId,
      body: comment.body,
      ...(comment.externalUrl ? { externalUrl: comment.externalUrl } : {}),
    });
    if (result.inserted) {
      inserted += 1;
    }
  }

  return inserted;
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
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
  runPlaneSyncCli()
    .then((summary) => {
      console.log("plane_sync=passed");
      console.log(`project_slug=${summary.projectSlug}`);
      console.log(`fetched_tasks=${summary.fetchedTasks}`);
      console.log(`upserted=${summary.upserted}`);
      console.log(`routed=${summary.routed}`);
      console.log(`unrouted=${summary.unrouted}`);
      console.log(`comments_fetched=${summary.commentsFetched}`);
      console.log(`comments_inserted=${summary.commentsInserted}`);
      console.log(`warnings=${summary.warnings.length}`);
      if (summary.nextCursor) {
        console.log(`next_cursor=${summary.nextCursor}`);
      }
    })
    .catch((error) => {
      console.error("plane_sync=failed");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
