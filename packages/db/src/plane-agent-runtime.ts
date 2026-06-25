import { createHash } from "node:crypto";
import { isAutomaticState, isWorkflowState, roleForState } from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";

export type PlaneProjectionEntityType =
  | "agent_project_workspace"
  | "agent_user_agent"
  | "agent_prompt"
  | "agent_prompt_version"
  | "agent_prompt_binding"
  | "agent_worker_card"
  | "agent_role"
  | "agent_repository"
  | "agent_user_secret_key";

export interface PlaneProjectionEventInput {
  planeWorkspaceId: string;
  planeOutboxId: bigint | number | string;
  entityType: PlaneProjectionEntityType;
  entityId: string;
  operation?: "create" | "update" | "delete" | string;
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
  payload: unknown;
}

export interface RunSnapshotRecord {
  id: string;
  runId: string;
  snapshotHash: string;
  payload: unknown;
  createdAt: Date;
}

export interface PlaneRuntimeSnapshotInput {
  runId: string;
  promptRelease?: {
    id: string;
    contentHash: string;
    renderedContent: string;
  };
  previousConversation?: {
    provider: string;
    conversationId: string;
    eventLogUri?: string;
    uiUrl?: string;
  };
}

export interface PlaneRuntimeSnapshotRecord extends RunSnapshotRecord {
  payload: PlaneRuntimeSnapshotPayload;
}

export interface PlaneRuntimePreviewRecord {
  snapshotHash: string;
  payload: PlaneRuntimeSnapshotPayload;
  createdAt: Date;
}

export interface PlaneRuntimeSnapshotPayload {
  schemaVersion: "plane-runtime-snapshot.v1";
  run: Record<string, unknown>;
  task: Record<string, unknown>;
  project: Record<string, unknown>;
  repository: Record<string, unknown>;
  role: Record<string, unknown>;
  agent: Record<string, unknown>;
  worker: Record<string, unknown>;
  prompts: PlaneRuntimePromptSnapshot[];
  assembledPrompt: string;
  availableSecretKeys: string[];
  legacyPromptRelease?: {
    id: string;
    contentHash: string;
    renderedContent: string;
  };
  previousConversation?: {
    provider: string;
    conversationId: string;
    eventLogUri?: string;
    uiUrl?: string;
  };
}

export interface PlaneRuntimePromptSnapshot {
  binding: Record<string, unknown>;
  prompt: Record<string, unknown>;
  version: Record<string, unknown>;
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

export async function createPlaneRuntimeSnapshotForRun(
  client: DatabaseClient,
  input: PlaneRuntimeSnapshotInput,
): Promise<PlaneRuntimeSnapshotRecord> {
  const context = await fetchPlaneRuntimeRunContext(client, input.runId);
  const worker = await fetchPlaneRuntimeWorkerCard(client, {
    planeWorkspaceId: context.plane_workspace_id,
    leaseOwner: context.lease_owner,
    defaultWorkerId: context.project_default_worker_id,
  });
  const prompts = await fetchPlaneRuntimePromptStack(client, context);
  const availableSecretKeys = await fetchPlaneRuntimeAvailableSecretKeys(client, context);
  const payload = buildPlaneRuntimeSnapshotPayload(
    context,
    worker,
    prompts,
    input,
    availableSecretKeys,
  );
  const snapshot = await recordRunSnapshot(client, { runId: input.runId, payload });

  return {
    ...snapshot,
    payload,
  };
}

export async function previewPlaneRuntimeForTask(
  client: DatabaseClient,
  input: {
    taskId: string;
    workerId?: string;
  },
): Promise<PlaneRuntimePreviewRecord | undefined> {
  const context = await fetchPlaneRuntimePreviewContext(client, input);
  if (!context) {
    return undefined;
  }

  const [worker, prompts, availableSecretKeys] = await Promise.all([
    fetchPlaneRuntimeWorkerCard(client, {
      planeWorkspaceId: context.plane_workspace_id ?? context.team_external_team_id,
      leaseOwner: input.workerId ?? context.project_default_worker_id,
      defaultWorkerId: context.project_default_worker_id,
    }),
    fetchPlaneRuntimePromptStack(client, context),
    fetchPlaneRuntimeAvailableSecretKeys(client, context),
  ]);
  const payload = buildPlaneRuntimeSnapshotPayload(
    context,
    worker,
    prompts,
    { runId: context.run_id },
    availableSecretKeys,
  );

  return {
    snapshotHash: hashJson(payload),
    payload,
    createdAt: context.run_created_at,
  };
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
    case "agent_project_workspace":
      await upsertProjectProjection(client, input);
      break;
    case "agent_user_agent":
      await upsertUserAgentProjection(client, input);
      break;
    case "agent_prompt":
      await upsertPromptProjection(client, input);
      break;
    case "agent_prompt_version":
      await upsertPromptVersionProjection(client, input);
      break;
    case "agent_prompt_binding":
      await upsertPromptBindingProjection(client, input);
      break;
    case "agent_worker_card":
      await upsertWorkerCardProjection(client, input);
      break;
    case "agent_role":
      await upsertRoleProjection(client, input);
      break;
    case "agent_repository":
      await upsertRepositoryProjection(client, input);
      break;
    case "agent_user_secret_key":
      await upsertUserSecretKeyProjection(client, input);
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
        status,
        source_updated_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, now())
      on conflict (plane_project_workspace_id) do update set
        plane_workspace_id = excluded.plane_workspace_id,
        plane_project_id = excluded.plane_project_id,
        slug = excluded.slug,
        default_worker_id = excluded.default_worker_id,
        meta_git_policy = excluded.meta_git_policy,
        projection_version = excluded.projection_version,
        status = excluded.status,
        source_updated_at = excluded.source_updated_at,
        updated_at = now()
      where acp_project_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      input.planeWorkspaceId,
      requiredStringFrom(payload, ["planeProjectId", "project"]),
      optionalStringFrom(payload, ["slug", "key"]) ??
        requiredStringFrom(payload, ["planeProjectId", "project"]),
      optionalStringFrom(payload, ["defaultWorkerId", "worker_card"]),
      JSON.stringify(projectMetaGitPolicy(payload)),
      input.projectionVersion,
      projectionStatus(input, payload),
      optionalStringFrom(payload, ["sourceUpdatedAt", "updated_at"]),
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
      optionalStringFrom(payload, ["ownerUserId", "owner"]) ?? "",
      requiredString(payload, "name"),
      optionalStringFrom(payload, ["defaultModel", "model"]) ??
        optionalStringFrom(payload, ["runtime"]) ??
        "codex",
      JSON.stringify(toolProfileSnapshot(payload)),
      JSON.stringify(configSnapshot(payload, ["defaults"])),
      input.projectionVersion,
      projectionStatus(input, payload),
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
      requiredStringFrom(payload, ["scope", "prompt_type"]),
      promptKind(payload),
      optionalScalarStringFrom(payload, ["latestVersionId", "latest_version"]),
      input.projectionVersion,
      projectionStatus(input, payload),
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
      requiredStringFrom(payload, ["planePromptId", "prompt"]),
      requiredNumber(payload, "version"),
      requiredString(payload, "body"),
      JSON.stringify(jsonValueFrom(payload, ["variables"], [])),
      optionalStringFrom(payload, ["contentHash", "content_hash"]) ??
        hashJson({
          body: requiredString(payload, "body"),
          variables: jsonValueFrom(payload, ["variables"], []),
        }),
      optionalStringFrom(payload, ["createdAt", "created_at"]),
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
      optionalStringFrom(payload, ["targetType"]) ?? "user_agent",
      optionalStringFrom(payload, ["targetId"]) ?? requiredStringFrom(payload, ["agent"]),
      requiredStringFrom(payload, ["planePromptId", "prompt"]),
      optionalStringFrom(payload, ["versionPolicy"]) ??
        (optionalStringFrom(payload, ["prompt_version"]) ? "pinned" : "latest"),
      optionalStringFrom(payload, ["pinnedVersionId", "prompt_version"]),
      requiredStringFrom(payload, ["scope", "slot"]),
      optionalNumberFrom(payload, ["orderIndex", "sort_order"]) ?? 0,
      optionalBooleanFrom(payload, ["required", "is_required"]) ?? true,
      projectionStatus(input, payload),
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
      requiredStringFrom(payload, ["workerId", "key"]),
      requiredString(payload, "name"),
      optionalStringFrom(payload, ["hostname"]),
      optionalStringFrom(payload, ["os"]),
      JSON.stringify(jsonValueFrom(payload, ["labels"], [])),
      optionalStringFrom(payload, ["workspaceRoot", "worker_endpoint"]),
      optionalStringFrom(payload, ["lastSeenAt"]),
      projectionStatus(input, payload, "offline"),
      input.projectionVersion,
    ],
  );
}

async function upsertRoleProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_role_projections (
        plane_role_id,
        plane_workspace_id,
        key,
        name,
        description,
        plane_prompt_id,
        metadata,
        status,
        projection_version,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now())
      on conflict (plane_role_id) do update set
        plane_workspace_id = excluded.plane_workspace_id,
        key = excluded.key,
        name = excluded.name,
        description = excluded.description,
        plane_prompt_id = excluded.plane_prompt_id,
        metadata = excluded.metadata,
        status = excluded.status,
        projection_version = excluded.projection_version,
        updated_at = now()
      where acp_role_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      input.planeWorkspaceId,
      requiredString(payload, "key"),
      requiredString(payload, "name"),
      optionalStringFrom(payload, ["description"]) ?? "",
      optionalStringFrom(payload, ["prompt"]),
      JSON.stringify(jsonValueFrom(payload, ["metadata"], {})),
      projectionStatus(input, payload),
      input.projectionVersion,
    ],
  );
}

async function upsertRepositoryProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_repository_projections (
        plane_repository_id,
        plane_workspace_id,
        plane_project_id,
        key,
        provider,
        name,
        url,
        default_branch,
        local_path,
        metadata,
        required,
        status,
        projection_version,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, now())
      on conflict (plane_repository_id) do update set
        plane_workspace_id = excluded.plane_workspace_id,
        plane_project_id = excluded.plane_project_id,
        key = excluded.key,
        provider = excluded.provider,
        name = excluded.name,
        url = excluded.url,
        default_branch = excluded.default_branch,
        local_path = excluded.local_path,
        metadata = excluded.metadata,
        required = excluded.required,
        status = excluded.status,
        projection_version = excluded.projection_version,
        updated_at = now()
      where acp_repository_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      input.planeWorkspaceId,
      optionalStringFrom(payload, ["project"]),
      requiredString(payload, "key"),
      optionalStringFrom(payload, ["provider"]) ?? "github",
      requiredString(payload, "name"),
      requiredString(payload, "url"),
      optionalStringFrom(payload, ["default_branch"]) ?? "default",
      optionalStringFrom(payload, ["local_path"]),
      JSON.stringify(jsonValueFrom(payload, ["metadata"], {})),
      optionalBooleanFrom(payload, ["required", "is_required"]) ?? true,
      projectionStatus(input, payload),
      input.projectionVersion,
    ],
  );
}

async function upsertUserSecretKeyProjection(
  client: DatabaseClient,
  input: PlaneProjectionEventInput,
): Promise<void> {
  const payload = input.payload;
  await client.query(
    `
      insert into acp_user_secret_key_projections (
        plane_secret_key_id,
        plane_workspace_id,
        owner_user_id,
        key,
        description,
        provider,
        provider_ref,
        status,
        projection_version,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      on conflict (plane_secret_key_id) do update set
        plane_workspace_id = excluded.plane_workspace_id,
        owner_user_id = excluded.owner_user_id,
        key = excluded.key,
        description = excluded.description,
        provider = excluded.provider,
        provider_ref = excluded.provider_ref,
        status = excluded.status,
        projection_version = excluded.projection_version,
        updated_at = now()
      where acp_user_secret_key_projections.projection_version <= excluded.projection_version
    `,
    [
      input.entityId,
      input.planeWorkspaceId,
      optionalStringFrom(payload, ["ownerUserId", "owner"]) ?? "",
      requiredString(payload, "key"),
      optionalStringFrom(payload, ["description"]) ?? "",
      optionalStringFrom(payload, ["provider"]) ?? "env",
      optionalStringFrom(payload, ["providerRef", "provider_ref"]) ?? "",
      projectionStatus(input, payload),
      input.projectionVersion,
    ],
  );
}

interface PlaneRuntimeRunContextRow {
  run_id: string;
  run_status: string;
  run_attempt: number;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  run_created_at: Date;
  task_id: string;
  external_task_id: string;
  identifier: string;
  title: string;
  task_state: string;
  task_url: string | null;
  labels: unknown;
  project_id: string;
  project_slug: string;
  project_name: string;
  project_external_project_id: string;
  team_key: string;
  team_external_team_id: string;
  repository_id: string;
  repository_slug: string;
  repository_git_url: string;
  repository_default_branch: string;
  repository_local_path: string | null;
  role_id: string;
  role_key: string;
  role_name: string;
  agent_definition_id: string;
  agent_name: string;
  agent_runtime: string;
  agent_model: string;
  agent_reasoning_effort: string;
  agent_tool_profile: string;
  agent_max_turns: number;
  agent_timeout_seconds: number;
  plane_project_workspace_id: string | null;
  plane_workspace_id: string | null;
  plane_project_id: string | null;
  project_default_worker_id: string | null;
  project_meta_git_policy: unknown;
  plane_repository_id: string | null;
  repository_key: string | null;
  repository_provider: string | null;
  repository_url: string | null;
  repository_metadata: unknown;
  plane_role_id: string | null;
  role_plane_prompt_id: string | null;
  role_metadata: unknown;
  plane_user_agent_id: string | null;
  user_agent_owner_user_id: string | null;
  user_agent_default_model: string | null;
  user_agent_tool_profile: unknown;
  user_agent_config_snapshot: unknown;
}

interface PlaneRuntimeWorkerCardRow {
  plane_worker_card_id: string;
  worker_id: string;
  name: string;
  hostname: string | null;
  os: string | null;
  labels: unknown;
  workspace_root: string | null;
  status: string;
  last_seen_at: Date | null;
  updated_at: Date;
}

interface PlaneRuntimePromptRow {
  plane_binding_id: string;
  target_type: string;
  target_id: string;
  version_policy: string;
  pinned_version_id: string | null;
  scope: string;
  order_index: number;
  required: boolean;
  binding_projection_version: string;
  plane_prompt_id: string;
  prompt_name: string;
  prompt_scope: string;
  prompt_kind: string;
  latest_version_id: string | null;
  prompt_status: string;
  plane_prompt_version_id: string | null;
  version: number | null;
  body: string | null;
  variables: unknown;
  content_hash: string | null;
  version_created_at: Date | null;
}

async function fetchPlaneRuntimeRunContext(
  client: DatabaseClient,
  runId: string,
): Promise<PlaneRuntimeRunContextRow> {
  const result = await client.query<PlaneRuntimeRunContextRow>(
    `
      select
        runs.id as run_id,
        runs.status as run_status,
        runs.attempt as run_attempt,
        runs.lease_owner,
        runs.lease_expires_at,
        runs.created_at as run_created_at,
        tasks.id as task_id,
        tasks.external_task_id,
        tasks.identifier,
        tasks.title,
        tasks.state as task_state,
        tasks.url as task_url,
        tasks.labels,
        projects.id as project_id,
        projects.slug as project_slug,
        projects.name as project_name,
        projects.external_project_id as project_external_project_id,
        teams.key as team_key,
        teams.external_team_id as team_external_team_id,
        repositories.id as repository_id,
        repositories.slug as repository_slug,
        repositories.git_url as repository_git_url,
        repositories.default_branch as repository_default_branch,
        repositories.local_path as repository_local_path,
        roles.id as role_id,
        roles.key as role_key,
        roles.name as role_name,
        agent_definitions.id as agent_definition_id,
        agent_definitions.name as agent_name,
        agent_definitions.runtime as agent_runtime,
        agent_definitions.model as agent_model,
        agent_definitions.reasoning_effort as agent_reasoning_effort,
        agent_definitions.tool_profile as agent_tool_profile,
        agent_definitions.max_turns as agent_max_turns,
        agent_definitions.timeout_seconds as agent_timeout_seconds,
        project_projection.plane_project_workspace_id,
        project_projection.plane_workspace_id,
        project_projection.plane_project_id,
        project_projection.default_worker_id as project_default_worker_id,
        project_projection.meta_git_policy as project_meta_git_policy,
        repository_projection.plane_repository_id,
        repository_projection.key as repository_key,
        repository_projection.provider as repository_provider,
        repository_projection.url as repository_url,
        repository_projection.metadata as repository_metadata,
        role_projection.plane_role_id,
        role_projection.plane_prompt_id as role_plane_prompt_id,
        role_projection.metadata as role_metadata,
        user_agent_projection.plane_user_agent_id,
        user_agent_projection.owner_user_id as user_agent_owner_user_id,
        user_agent_projection.default_model as user_agent_default_model,
        user_agent_projection.tool_profile as user_agent_tool_profile,
        user_agent_projection.config_snapshot as user_agent_config_snapshot
      from runs
      join tasks on tasks.id = runs.task_id
      join projects on projects.id = tasks.project_id
      join teams on teams.id = projects.team_id
      join repositories on repositories.id = runs.repository_id
      join roles on roles.id = runs.role_id
      join agent_definitions on agent_definitions.id = runs.agent_definition_id
      left join acp_project_projections project_projection
        on project_projection.status = 'active'
        and (
          project_projection.plane_project_id = projects.external_project_id
          or project_projection.slug = projects.slug
        )
      left join acp_repository_projections repository_projection
        on repository_projection.status = 'active'
        and (
          repository_projection.plane_repository_id = repositories.slug
          or repository_projection.url = repositories.git_url
          or (
            repository_projection.key = repositories.slug
            and (
              project_projection.plane_workspace_id is null
              or repository_projection.plane_workspace_id = project_projection.plane_workspace_id
            )
          )
        )
      left join acp_role_projections role_projection
        on role_projection.status = 'active'
        and role_projection.key = roles.key
        and (
          project_projection.plane_workspace_id is null
          or role_projection.plane_workspace_id = project_projection.plane_workspace_id
        )
      left join acp_user_agent_projections user_agent_projection
        on user_agent_projection.status = 'active'
        and (
          user_agent_projection.plane_user_agent_id = agent_definitions.id::text
          or user_agent_projection.name = agent_definitions.name
          or user_agent_projection.config_snapshot->>'key' = agent_definitions.name
        )
      where runs.id = $1
      order by
        case when project_projection.plane_project_id = projects.external_project_id then 0 else 1 end,
        case when repository_projection.url = repositories.git_url then 0 else 1 end,
        case when user_agent_projection.name = agent_definitions.name then 0 else 1 end
      limit 1
    `,
    [runId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Run not found for Plane runtime snapshot: ${runId}`);
  }
  return row;
}

async function fetchPlaneRuntimePreviewContext(
  client: DatabaseClient,
  input: {
    taskId: string;
    workerId?: string;
  },
): Promise<PlaneRuntimeRunContextRow | undefined> {
  const taskStateResult = await client.query<{ state: string }>(
    `
      select state
      from tasks
      where id = $1
      limit 1
    `,
    [input.taskId],
  );
  const state = taskStateResult.rows[0]?.state;
  if (!state || !isWorkflowState(state) || !isAutomaticState(state)) {
    return undefined;
  }
  const roleKey = roleForState(state);

  const result = await client.query<PlaneRuntimeRunContextRow>(
    `
      select
        'preview:' || tasks.id::text as run_id,
        'preview' as run_status,
        coalesce(previous_runs.next_attempt, 1) as run_attempt,
        $3::text as lease_owner,
        null::timestamptz as lease_expires_at,
        now() as run_created_at,
        tasks.id as task_id,
        tasks.external_task_id,
        tasks.identifier,
        tasks.title,
        tasks.state as task_state,
        tasks.url as task_url,
        tasks.labels,
        projects.id as project_id,
        projects.slug as project_slug,
        projects.name as project_name,
        projects.external_project_id as project_external_project_id,
        teams.key as team_key,
        teams.external_team_id as team_external_team_id,
        repositories.id as repository_id,
        repositories.slug as repository_slug,
        repositories.git_url as repository_git_url,
        repositories.default_branch as repository_default_branch,
        repositories.local_path as repository_local_path,
        roles.id as role_id,
        roles.key as role_key,
        roles.name as role_name,
        agent_definitions.id as agent_definition_id,
        agent_definitions.name as agent_name,
        agent_definitions.runtime as agent_runtime,
        agent_definitions.model as agent_model,
        agent_definitions.reasoning_effort as agent_reasoning_effort,
        agent_definitions.tool_profile as agent_tool_profile,
        agent_definitions.max_turns as agent_max_turns,
        agent_definitions.timeout_seconds as agent_timeout_seconds,
        project_projection.plane_project_workspace_id,
        project_projection.plane_workspace_id,
        project_projection.plane_project_id,
        project_projection.default_worker_id as project_default_worker_id,
        project_projection.meta_git_policy as project_meta_git_policy,
        repository_projection.plane_repository_id,
        repository_projection.key as repository_key,
        repository_projection.provider as repository_provider,
        repository_projection.url as repository_url,
        repository_projection.metadata as repository_metadata,
        role_projection.plane_role_id,
        role_projection.plane_prompt_id as role_plane_prompt_id,
        role_projection.metadata as role_metadata,
        user_agent_projection.plane_user_agent_id,
        user_agent_projection.owner_user_id as user_agent_owner_user_id,
        user_agent_projection.default_model as user_agent_default_model,
        user_agent_projection.tool_profile as user_agent_tool_profile,
        user_agent_projection.config_snapshot as user_agent_config_snapshot
      from tasks
      join projects on projects.id = tasks.project_id
      join teams on teams.id = projects.team_id
      join repositories on repositories.id = tasks.repository_id
      join roles on roles.key = $2
      join agent_definitions on agent_definitions.role_id = roles.id
        and agent_definitions.status = 'active'
      left join lateral (
        select coalesce(max(runs.attempt), 0) + 1 as next_attempt
        from runs
        where runs.task_id = tasks.id
      ) previous_runs on true
      left join lateral (
        select count(*)::integer as active_agent_runs
        from runs active_agent
        where active_agent.agent_definition_id = agent_definitions.id
          and active_agent.status in ('queued', 'claimed', 'running')
          and (
            active_agent.lease_expires_at is null
            or active_agent.lease_expires_at > now()
          )
      ) agent_load on true
      left join acp_project_projections project_projection
        on project_projection.status = 'active'
        and (
          project_projection.plane_project_id = projects.external_project_id
          or project_projection.slug = projects.slug
        )
      left join acp_repository_projections repository_projection
        on repository_projection.status = 'active'
        and (
          repository_projection.plane_repository_id = repositories.slug
          or repository_projection.url = repositories.git_url
          or (
            repository_projection.key = repositories.slug
            and (
              project_projection.plane_workspace_id is null
              or repository_projection.plane_workspace_id = project_projection.plane_workspace_id
            )
          )
        )
      left join acp_role_projections role_projection
        on role_projection.status = 'active'
        and role_projection.key = roles.key
        and (
          project_projection.plane_workspace_id is null
          or role_projection.plane_workspace_id = project_projection.plane_workspace_id
        )
      left join acp_user_agent_projections user_agent_projection
        on user_agent_projection.status = 'active'
        and (
          user_agent_projection.plane_user_agent_id = agent_definitions.id::text
          or user_agent_projection.name = agent_definitions.name
          or user_agent_projection.config_snapshot->>'key' = agent_definitions.name
        )
      where tasks.id = $1
        and tasks.repository_id is not null
        and tasks.state::text not in ('Done', 'Canceled', 'Duplicate')
      order by
        coalesce(agent_load.active_agent_runs, 0) asc,
        case when project_projection.plane_project_id = projects.external_project_id then 0 else 1 end,
        case when repository_projection.url = repositories.git_url then 0 else 1 end,
        case when user_agent_projection.name = agent_definitions.name then 0 else 1 end,
        agent_definitions.created_at asc
      limit 1
    `,
    [input.taskId, roleKey, input.workerId ?? null],
  );

  return result.rows[0];
}

async function fetchPlaneRuntimeWorkerCard(
  client: DatabaseClient,
  input: {
    planeWorkspaceId: string | null;
    leaseOwner: string | null;
    defaultWorkerId: string | null;
  },
): Promise<PlaneRuntimeWorkerCardRow | undefined> {
  if (!input.leaseOwner && !input.defaultWorkerId) {
    return undefined;
  }

  const result = await client.query<PlaneRuntimeWorkerCardRow>(
    `
      select
        plane_worker_card_id,
        worker_id,
        name,
        hostname,
        os,
        labels,
        workspace_root,
        status,
        last_seen_at,
        updated_at
      from acp_worker_card_projections
      where status <> 'archived'
        and (
          ($1::text is not null and plane_workspace_id = $1 and worker_id = $2)
          or ($1::text is not null and plane_workspace_id = $1 and plane_worker_card_id = $3)
          or worker_id = $2
        )
      order by
        case when worker_id = $2 then 0 else 1 end,
        case when status = 'online' then 0 when status = 'active' then 1 else 2 end,
        updated_at desc
      limit 1
    `,
    [input.planeWorkspaceId, input.leaseOwner, input.defaultWorkerId],
  );

  return result.rows[0];
}

async function fetchPlaneRuntimePromptStack(
  client: DatabaseClient,
  context: PlaneRuntimeRunContextRow,
): Promise<PlaneRuntimePromptSnapshot[]> {
  const planeWorkspaceId = context.plane_workspace_id ?? context.team_external_team_id;
  const agentTargetIds = compactStrings([
    context.plane_user_agent_id,
    context.agent_definition_id,
    context.agent_name,
  ]);
  const projectTargetIds = compactStrings([
    context.plane_project_workspace_id,
    context.plane_project_id,
    context.project_external_project_id,
    context.project_id,
    context.project_slug,
  ]);
  const repositoryTargetIds = compactStrings([
    context.plane_repository_id,
    context.repository_key,
    context.repository_id,
    context.repository_slug,
  ]);
  const roleTargetIds = compactStrings([context.plane_role_id, context.role_id, context.role_key]);

  const result = await client.query<PlaneRuntimePromptRow>(
    `
      select
        binding.plane_binding_id,
        binding.target_type,
        binding.target_id,
        binding.version_policy,
        binding.pinned_version_id,
        binding.scope,
        binding.order_index,
        binding.required,
        binding.projection_version::text as binding_projection_version,
        prompt.plane_prompt_id,
        prompt.name as prompt_name,
        prompt.scope as prompt_scope,
        prompt.kind as prompt_kind,
        prompt.latest_version_id,
        prompt.status as prompt_status,
        version.plane_prompt_version_id,
        version.version,
        version.body,
        version.variables,
        version.content_hash,
        version.created_at as version_created_at
      from acp_prompt_binding_projections binding
      join acp_prompt_projections prompt
        on prompt.plane_prompt_id = binding.plane_prompt_id
        and prompt.status = 'active'
      left join lateral (
        select version_projection.*
        from acp_prompt_version_projections version_projection
        where version_projection.plane_prompt_id = binding.plane_prompt_id
          and (
            (binding.version_policy = 'pinned'
              and version_projection.plane_prompt_version_id = binding.pinned_version_id)
            or binding.version_policy = 'latest'
          )
        order by
          case
            when binding.version_policy = 'latest'
              and prompt.latest_version_id is not null
              and version_projection.plane_prompt_version_id = prompt.latest_version_id
              then 0
            when binding.version_policy = 'pinned'
              and version_projection.plane_prompt_version_id = binding.pinned_version_id
              then 0
            else 1
          end,
          version_projection.version desc
        limit 1
      ) version on true
      where binding.status = 'active'
        and (
          (binding.target_type in ('agent', 'user_agent') and binding.target_id = any($2::text[]))
          or (binding.target_type = 'project' and binding.target_id = any($3::text[]))
          or (binding.target_type in ('repo', 'repository') and binding.target_id = any($4::text[]))
          or (binding.target_type = 'role' and binding.target_id = any($5::text[]))
          or (binding.target_type in ('task', 'system', 'playbook') and binding.target_id in ($1, 'global', 'system'))
        )
      order by
        case
          when binding.scope in ('agent', 'user_agent') then 10
          when binding.scope = 'project' then 20
          when binding.scope in ('repo', 'repository') then 25
          when binding.scope = 'role' then 30
          when binding.scope in ('playbook', 'task', 'system') then 40
          else 90
        end,
        binding.order_index asc,
        prompt.name asc
    `,
    [planeWorkspaceId, agentTargetIds, projectTargetIds, repositoryTargetIds, roleTargetIds],
  );

  return result.rows.map(mapPlaneRuntimePromptRow);
}

async function fetchPlaneRuntimeAvailableSecretKeys(
  client: DatabaseClient,
  context: PlaneRuntimeRunContextRow,
): Promise<string[]> {
  const planeWorkspaceId = context.plane_workspace_id ?? context.team_external_team_id;
  const ownerUserId = context.user_agent_owner_user_id ?? "";
  const projectedSecretKeys = await client.query<{ key: string }>(
    `
      select key
      from acp_user_secret_key_projections
      where status = 'active'
        and plane_workspace_id = $1
        and (
          owner_user_id = $2
          or owner_user_id = ''
          or owner_user_id is null
        )
      order by key asc
    `,
    [planeWorkspaceId, ownerUserId],
  );

  return compactStrings([
    ...extractAvailableSecretKeys(context.user_agent_config_snapshot),
    ...projectedSecretKeys.rows.map((row) => row.key),
  ]).sort();
}

function mapPlaneRuntimePromptRow(row: PlaneRuntimePromptRow): PlaneRuntimePromptSnapshot {
  return {
    binding: compactRecord({
      id: row.plane_binding_id,
      targetType: row.target_type,
      targetId: row.target_id,
      scope: row.scope,
      versionPolicy: row.version_policy,
      pinnedVersionId: row.pinned_version_id,
      orderIndex: row.order_index,
      required: row.required,
      projectionVersion: row.binding_projection_version,
    }),
    prompt: compactRecord({
      id: row.plane_prompt_id,
      name: row.prompt_name,
      scope: row.prompt_scope,
      kind: row.prompt_kind,
      latestVersionId: row.latest_version_id,
      status: row.prompt_status,
    }),
    version: compactRecord({
      id: row.plane_prompt_version_id,
      version: row.version,
      body: row.body,
      variables: row.variables ?? {},
      contentHash: row.content_hash,
      createdAt: isoDate(row.version_created_at),
    }),
  };
}

function buildPlaneRuntimeSnapshotPayload(
  context: PlaneRuntimeRunContextRow,
  worker: PlaneRuntimeWorkerCardRow | undefined,
  prompts: PlaneRuntimePromptSnapshot[],
  input: PlaneRuntimeSnapshotInput,
  availableSecretKeys: string[],
): PlaneRuntimeSnapshotPayload {
  const assembledPrompt = prompts
    .map((prompt) => stringFromUnknown(prompt.version.body))
    .filter((body) => body.length > 0)
    .join("\n\n---\n\n");

  const payload: PlaneRuntimeSnapshotPayload = {
    schemaVersion: "plane-runtime-snapshot.v1",
    run: compactRecord({
      id: context.run_id,
      status: context.run_status,
      attempt: context.run_attempt,
      leaseOwner: context.lease_owner,
      leaseExpiresAt: isoDate(context.lease_expires_at),
      createdAt: isoDate(context.run_created_at),
    }),
    task: compactRecord({
      id: context.task_id,
      externalTaskId: context.external_task_id,
      identifier: context.identifier,
      title: context.title,
      state: context.task_state,
      url: context.task_url,
      labels: context.labels ?? [],
    }),
    project: compactRecord({
      id: context.project_id,
      slug: context.project_slug,
      name: context.project_name,
      externalProjectId: context.project_external_project_id,
      planeProjectWorkspaceId: context.plane_project_workspace_id,
      planeWorkspaceId: context.plane_workspace_id ?? context.team_external_team_id,
      planeProjectId: context.plane_project_id,
      defaultWorkerId: context.project_default_worker_id,
      metaGitPolicy: context.project_meta_git_policy ?? {},
    }),
    repository: compactRecord({
      id: context.repository_id,
      slug: context.repository_slug,
      gitUrl: context.repository_git_url,
      defaultBranch: context.repository_default_branch,
      localPath: context.repository_local_path,
      planeRepositoryId: context.plane_repository_id,
      key: context.repository_key,
      provider: context.repository_provider,
      url: context.repository_url,
      metadata: context.repository_metadata ?? {},
    }),
    role: compactRecord({
      id: context.role_id,
      key: context.role_key,
      name: context.role_name,
      planeRoleId: context.plane_role_id,
      planePromptId: context.role_plane_prompt_id,
      metadata: context.role_metadata ?? {},
    }),
    agent: compactRecord({
      id: context.agent_definition_id,
      name: context.agent_name,
      runtime: context.agent_runtime,
      model: context.agent_model,
      reasoningEffort: context.agent_reasoning_effort,
      toolProfile: context.agent_tool_profile,
      maxTurns: context.agent_max_turns,
      timeoutSeconds: context.agent_timeout_seconds,
      planeUserAgentId: context.plane_user_agent_id,
      defaultModel: context.user_agent_default_model,
      planeToolProfile: context.user_agent_tool_profile ?? {},
      configSnapshot: redactSecretConfigSnapshot(context.user_agent_config_snapshot),
    }),
    worker: compactRecord({
      requestedWorkerId: context.lease_owner,
      defaultWorkerId: context.project_default_worker_id,
      planeWorkerCardId: worker?.plane_worker_card_id,
      workerId: worker?.worker_id,
      name: worker?.name,
      hostname: worker?.hostname,
      os: worker?.os,
      labels: worker?.labels ?? [],
      workspaceRoot: worker?.workspace_root,
      status: worker?.status,
      lastSeenAt: isoDate(worker?.last_seen_at),
      updatedAt: isoDate(worker?.updated_at),
    }),
    prompts,
    assembledPrompt,
    availableSecretKeys,
  };

  if (input.promptRelease) {
    payload.legacyPromptRelease = input.promptRelease;
  }

  if (input.previousConversation) {
    payload.previousConversation = input.previousConversation;
  }

  return payload;
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

function compactRecord(values: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) {
      record[key] = value;
    }
  }
  return record;
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function isoDate(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractAvailableSecretKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.secretKeys,
    record.secret_keys,
    record.availableSecretKeys,
    record.available_secret_keys,
  ];
  const keys = new Set<string>();

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string" && item.trim()) {
          keys.add(item.trim());
        }
      }
    }
  }

  const objectCandidates = [record.secrets, record.secretRefs, record.secret_refs];
  for (const candidate of objectCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      for (const key of Object.keys(candidate)) {
        if (key.trim()) {
          keys.add(key.trim());
        }
      }
    }
  }

  return [...keys].sort();
}

function redactSecretConfigSnapshot(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return {};
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecretConfigSnapshot(item));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(secrets?|secretRefs?|secret_refs)$/i.test(key)) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        output[key] = Object.fromEntries(Object.keys(child).map((secretKey) => [secretKey, true]));
      } else {
        output[key] = child;
      }
      continue;
    }

    output[key] = child && typeof child === "object" ? redactSecretConfigSnapshot(child) : child;
  }

  return output;
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

function requiredStringFrom(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = optionalStringFrom(payload, [key]);
    if (value) {
      return value;
    }
  }
  throw new Error(`Projection payload requires non-empty string field: ${keys.join("|")}`);
}

function optionalStringFrom(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function optionalScalarStringFrom(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "bigint") {
      return String(value);
    }
  }
  return null;
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

function optionalNumberFrom(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
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

function optionalBooleanFrom(payload: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
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

function jsonValueFrom(
  payload: Record<string, unknown>,
  keys: string[],
  fallback: unknown,
): unknown {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return fallback;
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

function projectionStatus(
  input: PlaneProjectionEventInput,
  payload: Record<string, unknown>,
  inactiveStatus = "disabled",
): string {
  if (input.operation === "delete") {
    return "archived";
  }
  const status = optionalStringFrom(payload, ["status"]);
  if (status) {
    return status;
  }
  const isActive = optionalBooleanFrom(payload, ["is_active"]);
  if (isActive !== null) {
    return isActive ? "active" : inactiveStatus;
  }
  return "active";
}

function projectMetaGitPolicy(payload: Record<string, unknown>): Record<string, unknown> {
  const explicit = jsonValueFrom(payload, ["metaGitPolicy"], null);
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    return explicit as Record<string, unknown>;
  }
  return {
    localPath: optionalStringFrom(payload, ["local_path"]),
    statusPath: optionalStringFrom(payload, ["status_path"]) ?? "status.md",
    progressPath: optionalStringFrom(payload, ["progress_path"]) ?? "progress.md",
    metaPath: optionalStringFrom(payload, ["meta_path"]) ?? "meta.md",
    metadata: jsonValueFrom(payload, ["metadata"], {}),
  };
}

function toolProfileSnapshot(payload: Record<string, unknown>): unknown {
  const explicit = jsonValueFrom(payload, ["toolProfile"], undefined);
  if (explicit !== undefined) {
    return explicit;
  }
  return {
    tools: jsonValueFrom(payload, ["tools"], []),
  };
}

function configSnapshot(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const explicit = jsonValueFrom(payload, ["configSnapshot"], null);
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    return explicit as Record<string, unknown>;
  }
  return {
    key: optionalStringFrom(payload, ["key"]),
    description: optionalStringFrom(payload, ["description"]) ?? "",
    runtime: optionalStringFrom(payload, ["runtime"]) ?? "codex",
    defaults: jsonValueFrom(payload, keys, {}),
    isDefault: optionalBooleanFrom(payload, ["is_default"]) ?? false,
  };
}

function promptKind(payload: Record<string, unknown>): string {
  const direct = optionalStringFrom(payload, ["kind"]);
  if (direct) {
    return direct;
  }
  const metadata = jsonValueFrom(payload, ["metadata"], {});
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const metadataKind = (metadata as Record<string, unknown>).kind;
    if (typeof metadataKind === "string" && metadataKind.length > 0) {
      return metadataKind;
    }
  }
  return "instruction";
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
