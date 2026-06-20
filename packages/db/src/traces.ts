import type { DatabaseClient } from "./client.js";

export interface TraceRefInput {
  runId: string;
  provider: string;
  traceId: string;
  generationId?: string;
  model?: string;
  promptReleaseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: string;
  latencyMs?: number;
  uiUrl?: string;
}

export interface TraceRefRecord {
  id: string;
  runId: string;
  provider: string;
  traceId: string;
  generationId?: string;
  model?: string;
  promptReleaseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: string;
  latencyMs?: number;
  uiUrl?: string;
  createdAt: Date;
}

interface TraceRefRow {
  id: string;
  run_id: string;
  provider: string;
  trace_id: string;
  generation_id: string | null;
  model: string | null;
  prompt_release_id: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cost_usd: string | null;
  latency_ms: number | null;
  ui_url: string | null;
  created_at: Date;
}

export async function insertTraceRef(
  client: DatabaseClient,
  input: TraceRefInput,
): Promise<TraceRefRecord> {
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  const tokenTotal =
    inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
  const result = await client.query<TraceRefRow>(
    `
      with inserted as (
        insert into trace_refs (
          id,
          run_id,
          provider,
          trace_id,
          generation_id,
          model,
          prompt_release_id,
          input_tokens,
          output_tokens,
          cost_usd,
          latency_ms,
          ui_url,
          created_at
        )
        values (
          gen_random_uuid(),
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          now()
        )
        returning
          id,
          run_id,
          provider,
          trace_id,
          generation_id,
          model,
          prompt_release_id,
          input_tokens,
          output_tokens,
          cost_usd,
          latency_ms,
          ui_url,
          created_at
      ),
      run_update as (
        update runs
        set
          token_input = coalesce(token_input, 0) + coalesce($7::bigint, 0),
          token_output = coalesce(token_output, 0) + coalesce($8::bigint, 0),
          token_total = coalesce(token_total, 0) + coalesce($12::bigint, 0),
          cost_usd = coalesce(cost_usd, 0) + coalesce($9::numeric, 0),
          updated_at = now()
        where id = $1
        returning id
      )
      select *
      from inserted
    `,
    [
      input.runId,
      input.provider,
      input.traceId,
      input.generationId ?? null,
      input.model ?? null,
      input.promptReleaseId ?? null,
      inputTokens,
      outputTokens,
      input.costUsd ?? null,
      input.latencyMs ?? null,
      input.uiUrl ?? null,
      tokenTotal,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to insert trace ref for run: ${input.runId}`);
  }

  return mapTraceRefRow(row);
}

function mapTraceRefRow(row: TraceRefRow): TraceRefRecord {
  const record: TraceRefRecord = {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    traceId: row.trace_id,
    createdAt: row.created_at,
  };

  if (row.generation_id) {
    record.generationId = row.generation_id;
  }

  if (row.model) {
    record.model = row.model;
  }

  if (row.prompt_release_id) {
    record.promptReleaseId = row.prompt_release_id;
  }

  if (row.input_tokens) {
    record.inputTokens = Number.parseInt(row.input_tokens, 10);
  }

  if (row.output_tokens) {
    record.outputTokens = Number.parseInt(row.output_tokens, 10);
  }

  if (row.cost_usd) {
    record.costUsd = row.cost_usd;
  }

  if (row.latency_ms !== null) {
    record.latencyMs = row.latency_ms;
  }

  if (row.ui_url) {
    record.uiUrl = row.ui_url;
  }

  return record;
}
