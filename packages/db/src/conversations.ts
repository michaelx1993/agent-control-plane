import type { DatabaseClient } from "./client.js";

export interface ConversationRefInput {
  runId: string;
  provider: string;
  conversationId: string;
  eventLogUri?: string;
  eventCursor?: string;
  uiUrl?: string;
}

export interface ConversationRefRecord {
  id: string;
  runId: string;
  provider: string;
  conversationId: string;
  eventLogUri?: string;
  eventCursor?: string;
  uiUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationRefRow {
  id: string;
  run_id: string;
  provider: string;
  conversation_id: string;
  event_log_uri: string | null;
  event_cursor: string | null;
  ui_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function upsertConversationRef(
  client: DatabaseClient,
  input: ConversationRefInput,
): Promise<ConversationRefRecord> {
  const result = await client.query<ConversationRefRow>(
    `
      insert into conversation_refs (
        id,
        run_id,
        provider,
        conversation_id,
        event_log_uri,
        event_cursor,
        ui_url,
        created_at,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now())
      on conflict (run_id)
      do update set
        provider = excluded.provider,
        conversation_id = excluded.conversation_id,
        event_log_uri = excluded.event_log_uri,
        event_cursor = excluded.event_cursor,
        ui_url = excluded.ui_url,
        updated_at = now()
      returning
        id,
        run_id,
        provider,
        conversation_id,
        event_log_uri,
        event_cursor,
        ui_url,
        created_at,
        updated_at
    `,
    [
      input.runId,
      input.provider,
      input.conversationId,
      input.eventLogUri ?? null,
      input.eventCursor ?? null,
      input.uiUrl ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to upsert conversation ref for run: ${input.runId}`);
  }

  const record: ConversationRefRecord = {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.event_log_uri) {
    record.eventLogUri = row.event_log_uri;
  }

  if (row.event_cursor) {
    record.eventCursor = row.event_cursor;
  }

  if (row.ui_url) {
    record.uiUrl = row.ui_url;
  }

  return record;
}

export async function findLatestConversationRefForTask(
  client: DatabaseClient,
  input: {
    taskId: string;
    beforeRunId?: string;
    provider?: string;
  },
): Promise<ConversationRefRecord | undefined> {
  const values: Array<string> = [input.taskId];
  const filters = ["runs.task_id = $1"];

  if (input.beforeRunId) {
    values.push(input.beforeRunId);
    filters.push(`runs.id <> $${values.length}`);
  }

  if (input.provider) {
    values.push(input.provider);
    filters.push(`conversation_refs.provider = $${values.length}`);
  }

  const result = await client.query<ConversationRefRow>(
    `
      select
        conversation_refs.id,
        conversation_refs.run_id,
        conversation_refs.provider,
        conversation_refs.conversation_id,
        conversation_refs.event_log_uri,
        conversation_refs.event_cursor,
        conversation_refs.ui_url,
        conversation_refs.created_at,
        conversation_refs.updated_at
      from conversation_refs
      join runs on runs.id = conversation_refs.run_id
      where ${filters.join(" and ")}
      order by conversation_refs.updated_at desc
      limit 1
    `,
    values,
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  const record: ConversationRefRecord = {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.event_log_uri) {
    record.eventLogUri = row.event_log_uri;
  }

  if (row.event_cursor) {
    record.eventCursor = row.event_cursor;
  }

  if (row.ui_url) {
    record.uiUrl = row.ui_url;
  }

  return record;
}
