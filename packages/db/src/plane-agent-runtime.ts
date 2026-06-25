import { createHash } from "node:crypto";
import type { DatabaseClient } from "./client.js";

export type PlaneProjectionEntityType =
  | "project_workspace"
  | "user_agent"
  | "prompt"
  | "prompt_version"
  | "prompt_binding"
  | "worker_card";

export interface PlaneProjectionEventInput {
  planeWorkspaceId: string;
  planeOutboxId: bigint | number | string;
  entityType: PlaneProjectionEntityType;
  entityId: string;
  projectionVersion: bigint | number | string;
  payload: Record<string, unknown>;
}

export interface ProjectionApplyResult {
  status: "applied" | "skipped";
  entityType: PlaneProjectionEntityType;
  entityId: string;
  payloadHash: string;
}

export interface RunSnapshotInput {
  runId: string;
  payload: Record<string, unknown>;
}

export interface RunSnapshotRecord {
  id: string;
  runId: string;
  snapshotHash: string;
  payload: unknown;
  createdAt: Date;
}

export interface RuntimePipelineNodeInput {
  nodeKey: string;
  nodeType: "agent" | "human_gate";
  roleKey?: string;
  assignedAgentId?: string;
  gateMode?: "manual" | "auto" | "conditional";
  status?: string;
  orderIndex?: number;
  inputSnapshot?: Record<string, unknown>;
}

export interface RuntimePipelineTransitionInput {
  fromNodeKey: string;
  toNodeKey: string;
  condition?: Record<string, unknown>;
  gateMode?: "manual" | "auto" | "conditional";
  orderIndex?: number;
}

export interface CreateRunPipelineInput {
  runId: string;
  planePlaybookVersionId?: string;
  nodes: RuntimePipelineNodeInput[];
  transitions?: RuntimePipelineTransitionInput[];
}

export interface RuntimePipelineRecord {
  id: string;
  runId: string;
  nodeCount: number;
  transitionCount: number;
}

export interface PlaneAgentConfigOutboxCursor {
  planeWorkspaceId: string;
  cursor?: string;
}

interface ProjectionEventInsertRow {
  id: string;
}

interface SnapshotRow {
  id: string;
  run_id: string;
  snapshot_hash: string;
  payload: unknown;
  created_at: Date;
}

interface PipelineRow {
  id: string;
  run_id: string;
}

export async function applyPlaneProjectionEvent(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<ProjectionApplyResult> {
  const payloadHash = hashJson(input.payload);
  const eventResult = await client.query<ProjectionEventInsertRow>(
    `
      insert into acp_config_projection_events (
        plane_workspace_id,
        plane_outbox_id,
        entity_type,
        entity_id,
        projection_version,
        payload_hash,
        status,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, 'applied', now())
      on conflict (plane_workspace_id, plane_outbox_id) do nothing
      returning id
    `,
    [
      input.planeWorkspaceId,
      input.planeOutboxId,
      input.entityType,
      input.entityId,
      input.projectionVersion,
      payloadHash,
    ],
  );

  if (!eventResult.rows[0]) {
    return {
      status: "skipped",
      entityType: input.entityType,
      entityId: input.entityId,
      payloadHash,
    };
  }

  try {
    await upsertProjectionPayload(client, input);
  } catch (error) {
    await client.query(
      `
        update acp_config_projection_events
        set status = 'failed',
            error = $3
        where plane_workspace_id = $1
          and plane_outbox_id = $2
      `,
      [input.planeWorkspaceId, input.planeOutboxId, errorToMessage(error)],
    );
    throw error;
  }

  return {
    status: "applied",
    entityType: input.entityType,
    entityId: input.entityId,
    payloadHash,
  };
}

export async function recordRunSnapshot(
  client: DatabaseClient,
  input: RunSnapshotInput,
): Promise<RunSnapshotRecord> {
  const snapshotHash = hashJson(input.payload);
  const insertResult = await client.query<SnapshotRow>(
    `
      insert into acp_run_snapshots (
        run_id,
        snapshot_hash,
        payload,
        created_at
      )
      values ($1, $2, $3::jsonb, now())
      on conflict (run_id) do nothing
      returning *
    `,
    [input.runId, snapshotHash, JSON.stringify(input.payload)],
  );

  const row = insertResult.rows[0] ?? (await fetchExistingRunSnapshot(client, input.runId));
  if (row.snapshot_hash !== snapshotHash) {
    throw new Error(`Run snapshot already exists with a different hash for run ${input.runId}`);
  }

  return mapSnapshotRow(row);
}

export async function createRunPipeline(
  client: DatabaseClient,
  input: CreateRunPipelineInput,
): Promise<RuntimePipelineRecord> {
  if (input.nodes.length === 0) {
    throw new Error("Run pipeline requires at least one node");
  }

  const pipelineResult = await client.query<PipelineRow>(
    `
      insert into acp_run_pipelines (
        run_id,
        plane_playbook_version_id,
        status,
        created_at,
        updated_at
      )
      values ($1, $2, 'active', now(), now())
      on conflict (run_id) do update set
        plane_playbook_version_id = excluded.plane_playbook_version_id,
        status = 'active',
        updated_at = now()
      returning id, run_id
    `,
    [input.runId, input.planePlaybookVersionId ?? null],
  );

  const pipeline = pipelineResult.rows[0];
  if (!pipeline) {
    throw new Error(`Failed to create runtime pipeline for run ${input.runId}`);
  }

  for (const [index, node] of input.nodes.entries()) {
    await client.query(
      `
        insert into acp_run_pipeline_nodes (
          run_pipeline_id,
          node_key,
          node_type,
          role_key,
          assigned_agent_id,
          gate_mode,
          status,
          order_index,
          input_snapshot,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
        on conflict (run_pipeline_id, node_key) do update set
          node_type = excluded.node_type,
          role_key = excluded.role_key,
          assigned_agent_id = excluded.assigned_agent_id,
          gate_mode = excluded.gate_mode,
          status = excluded.status,
          order_index = excluded.order_index,
          input_snapshot = excluded.input_snapshot,
          updated_at = now()
      `,
      [
        pipeline.id,
        node.nodeKey,
        node.nodeType,
        node.roleKey ?? null,
        node.assignedAgentId ?? null,
        node.gateMode ?? "manual",
        node.status ?? "pending",
        node.orderIndex ?? index,
        JSON.stringify(node.inputSnapshot ?? {}),
      ],
    );
  }

  for (const [index, transition] of (input.transitions ?? []).entries()) {
    await client.query(
      `
        insert into acp_run_pipeline_transitions (
          run_pipeline_id,
          from_node_key,
          to_node_key,
          condition,
          gate_mode,
          order_index
        )
        values ($1, $2, $3, $4::jsonb, $5, $6)
        on conflict (run_pipeline_id, from_node_key, to_node_key, order_index) do update set
          condition = excluded.condition,
          gate_mode = excluded.gate_mode
      `,
      [
        pipeline.id,
        transition.fromNodeKey,
        transition.toNodeKey,
        JSON.stringify(transition.condition ?? {}),
        transition.gateMode ?? "manual",
        transition.orderIndex ?? index,
      ],
    );
  }

  return {
    id: pipeline.id,
    runId: pipeline.run_id,
    nodeCount: input.nodes.length,
    transitionCount: input.transitions?.length ?? 0,
  };
}

export async function getPlaneAgentConfigOutboxCursor(
  client: DatabaseClient,
  planeWorkspaceId: string,
): Promise<string | undefined> {
  const result = await client.query<{ value: unknown }>(
    `
      select value
      from app_settings
      where key = $1
      limit 1
    `,
    [planeAgentConfigOutboxCursorKey(planeWorkspaceId)],
  );

  return normalizeCursorValue(result.rows[0]?.value);
}

export async function updatePlaneAgentConfigOutboxCursor(
  client: DatabaseClient,
  input: PlaneAgentConfigOutboxCursor,
): Promise<void> {
  if (!input.cursor) {
    return;
  }

  await client.query(
    `
      insert into app_settings (key, value, description, updated_at)
      values ($1, to_jsonb($2::text), $3, now())
      on conflict (key) do update set
        value = excluded.value,
        description = excluded.description,
        updated_at = now()
    `,
    [
      planeAgentConfigOutboxCursorKey(input.planeWorkspaceId),
      input.cursor,
      `Plane agent config outbox cursor for workspace ${input.planeWorkspaceId}.`,
    ],
  );
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function latestPlaneOutboxCursor(
  currentCursor: string | undefined,
  events: readonly { id: number | string | bigint }[],
): string | undefined {
  return (
    events
      .map((event) => String(event.id))
      .sort(compareNumericStrings)
      .at(-1) ?? currentCursor
  );
}

async function fetchExistingRunSnapshot(
  client: DatabaseClient,
  runId: string,
): Promise<SnapshotRow> {
  const result = await client.query<SnapshotRow>(
    `
      select *
      from acp_run_snapshots
      where run_id = $1
    `,
    [runId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to record run snapshot for run ${runId}`);
  }

  return row;
}

async function upsertProjectionPayload(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  switch (input.entityType) {
    case "project_workspace":
      await upsertProjectProjection(client, input);
      break;
    case "user_agent":
      await upsertUserAgentProjection(client, input);
      break;
    case "prompt":
      await upsertPromptProjection(client, input);
      break;
    case "prompt_version":
      await upsertPromptVersionProjection(client, input);
      break;
    case "prompt_binding":
      await upsertPromptBindingProjection(client, input);
      break;
    case "worker_card":
      await upsertWorkerCardProjection(client, input);
      break;
  }
}

async function upsertProjectProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_project_projections (
        plane_project_workspace_id,
        plane_workspace_id,
        plane_project_id,
        slug,
        default_worker_id,
        meta_git_policy,
        projection_version,
        source_updated_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
      on conflict (plane_project_workspace_id) do update set
        plane_workspace_id = excluded.plane_workspace_id,
        plane_project_id = excluded.plane_project_id,
        slug = excluded.slug,
        default_worker_id = excluded.default_worker_id,
        meta_git_policy = excluded.meta_git_policy,
        projection_version = excluded.projection_version,
        source_updated_at = excluded.source_updated_at,
        updated_at = now()
      where acp_project_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      input.planeWorkspaceId,
      requiredString(payload, "planeProjectId"),
      requiredString(payload, "slug"),
      optionalString(payload, "defaultWorkerId"),
      JSON.stringify(objectValue(payload, "metaGitPolicy")),
      input.projectionVersion,
      optionalString(payload, "sourceUpdatedAt"),
    ],
  );
}

async function upsertUserAgentProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_user_agent_projections (
        plane_user_agent_id,
        owner_user_id,
        name,
        default_model,
        tool_profile,
        config_snapshot,
        projection_version,
        status,
        updated_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, now())
      on conflict (plane_user_agent_id) do update set
        owner_user_id = excluded.owner_user_id,
        name = excluded.name,
        default_model = excluded.default_model,
        tool_profile = excluded.tool_profile,
        config_snapshot = excluded.config_snapshot,
        projection_version = excluded.projection_version,
        status = excluded.status,
        updated_at = now()
      where acp_user_agent_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      requiredString(payload, "ownerUserId"),
      requiredString(payload, "name"),
      requiredString(payload, "defaultModel"),
      JSON.stringify(objectValue(payload, "toolProfile")),
      JSON.stringify(objectValue(payload, "configSnapshot")),
      input.projectionVersion,
      optionalString(payload, "status") ?? "active",
    ],
  );
}

async function upsertPromptProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_prompt_projections (
        plane_prompt_id,
        workspace_id,
        name,
        scope,
        kind,
        latest_version_id,
        projection_version,
        status,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, now())
      on conflict (plane_prompt_id) do update set
        workspace_id = excluded.workspace_id,
        name = excluded.name,
        scope = excluded.scope,
        kind = excluded.kind,
        latest_version_id = excluded.latest_version_id,
        projection_version = excluded.projection_version,
        status = excluded.status,
        updated_at = now()
      where acp_prompt_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      input.planeWorkspaceId,
      requiredString(payload, "name"),
      requiredString(payload, "scope"),
      requiredString(payload, "kind"),
      optionalString(payload, "latestVersionId"),
      input.projectionVersion,
      optionalString(payload, "status") ?? "active",
    ],
  );
}

async function upsertPromptVersionProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_prompt_version_projections (
        plane_prompt_version_id,
        plane_prompt_id,
        version,
        body,
        variables,
        content_hash,
        created_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6, coalesce($7::timestamptz, now()))
      on conflict (plane_prompt_version_id) do update set
        plane_prompt_id = excluded.plane_prompt_id,
        version = excluded.version,
        body = excluded.body,
        variables = excluded.variables,
        content_hash = excluded.content_hash
    `,
    [
      input.entityId,
      requiredString(payload, "planePromptId"),
      requiredNumber(payload, "version"),
      requiredString(payload, "body"),
      JSON.stringify(objectValue(payload, "variables")),
      requiredString(payload, "contentHash"),
      optionalString(payload, "createdAt"),
    ],
  );
}

async function upsertPromptBindingProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_prompt_binding_projections (
        plane_binding_id,
        target_type,
        target_id,
        plane_prompt_id,
        version_policy,
        pinned_version_id,
        scope,
        order_index,
        required,
        status,
        projection_version,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (plane_binding_id) do update set
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        plane_prompt_id = excluded.plane_prompt_id,
        version_policy = excluded.version_policy,
        pinned_version_id = excluded.pinned_version_id,
        scope = excluded.scope,
        order_index = excluded.order_index,
        required = excluded.required,
        status = excluded.status,
        projection_version = excluded.projection_version,
        updated_at = now()
      where acp_prompt_binding_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      requiredString(payload, "targetType"),
      requiredString(payload, "targetId"),
      requiredString(payload, "planePromptId"),
      requiredString(payload, "versionPolicy"),
      optionalString(payload, "pinnedVersionId"),
      requiredString(payload, "scope"),
      optionalNumber(payload, "orderIndex") ?? 0,
      optionalBoolean(payload, "required") ?? true,
      optionalString(payload, "status") ?? "active",
      input.projectionVersion,
    ],
  );
}

async function upsertWorkerCardProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_worker_card_projections (
        plane_worker_card_id,
        plane_workspace_id,
        worker_id,
        name,
        hostname,
        os,
        labels,
        workspace_root,
        last_seen_at,
        status,
        projection_version,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, now())
      on conflict (plane_worker_card_id) do update set
        plane_workspace_id = excluded.plane_workspace_id,
        worker_id = excluded.worker_id,
        name = excluded.name,
        hostname = excluded.hostname,
        os = excluded.os,
        labels = excluded.labels,
        workspace_root = excluded.workspace_root,
        last_seen_at = excluded.last_seen_at,
        status = excluded.status,
        projection_version = excluded.projection_version,
        updated_at = now()
      where acp_worker_card_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      input.planeWorkspaceId,
      requiredString(payload, "workerId"),
      requiredString(payload, "name"),
      optionalString(payload, "hostname"),
      optionalString(payload, "os"),
      JSON.stringify(arrayValue(payload, "labels")),
      optionalString(payload, "workspaceRoot"),
      optionalString(payload, "lastSeenAt"),
      optionalString(payload, "status") ?? "offline",
      input.projectionVersion,
    ],
  );
}

function mapSnapshotRow(row: SnapshotRow): RunSnapshotRecord {
  return {
    id: row.id,
    runId: row.run_id,
    snapshotHash: row.snapshot_hash,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function planeAgentConfigOutboxCursorKey(planeWorkspaceId: string): string {
  return `plane.agent_config_outbox_cursor.${planeWorkspaceId}`;
}

function normalizeCursorValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
}

function compareNumericStrings(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Projection payload requires non-empty string field: ${key}`);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Projection payload field must be a string: ${key}`);
  }
  return value;
}

function requiredNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Projection payload requires finite number field: ${key}`);
  }
  return value;
}

function optionalNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Projection payload field must be a finite number: ${key}`);
  }
  return value;
}

function optionalBoolean(payload: Record<string, unknown>, key: string): boolean | null {
  const value = payload[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Projection payload field must be a boolean: ${key}`);
  }
  return value;
}

function objectValue(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Projection payload field must be an object: ${key}`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(payload: Record<string, unknown>, key: string): unknown[] {
  const value = payload[key];
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Projection payload field must be an array: ${key}`);
  }
  return value;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
