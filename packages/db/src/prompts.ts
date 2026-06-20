import { createHash, randomUUID } from "node:crypto";
import { renderPrompt, type PromptComponent, type PromptScope } from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";

export interface PromptReleaseRecord {
  id: string;
  runId?: string;
  taskId: string;
  repositoryId: string;
  roleId: string;
  agentDefinitionId: string;
  contentHash: string;
  renderedContent: string;
  componentIds: string[];
}

export interface PromptReleaseListItem {
  id: string;
  taskIdentifier: string;
  repositorySlug: string;
  roleKey: string;
  agentName: string;
  contentHash: string;
  componentCount: number;
  createdAt: Date;
}

export interface PromptReleaseComponentDetail {
  promptComponentId: string;
  scope: PromptScope;
  name: string;
  version: number;
  orderIndex: number;
  contentHash: string;
  content: string;
}

export interface PromptReleaseRunRef {
  runId: string;
  status: string;
  attempt: number;
  createdAt: Date;
}

export interface PromptReleaseDetailRecord {
  id: string;
  taskId: string;
  taskIdentifier: string;
  taskTitle: string;
  repositoryId: string;
  repositorySlug: string;
  roleId: string;
  roleKey: string;
  agentDefinitionId: string;
  agentName: string;
  contentHash: string;
  renderedContent: string;
  createdAt: Date;
  components: PromptReleaseComponentDetail[];
  runs: PromptReleaseRunRef[];
}

export type PromptComponentStatus = "draft" | "active" | "archived";

export interface PromptComponentListFilter {
  scope?: PromptScope;
  status?: PromptComponentStatus;
  limit?: number;
}

export interface PromptComponentListItem {
  id: string;
  scope: PromptScope;
  scopeId?: string;
  name: string;
  version: number;
  status: PromptComponentStatus;
  author?: string;
  changelog?: string;
  contentHash: string;
  boundCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptComponentDetailRecord extends PromptComponentListItem {
  content: string;
  versions: PromptComponentListItem[];
}

export interface CreatePromptComponentVersionInput {
  scope: PromptScope;
  scopeId?: string;
  name: string;
  content: string;
  status?: PromptComponentStatus;
  changelog?: string;
  author?: string;
}

export interface PromptComponentMutationResult {
  updated: boolean;
  componentId?: string;
  reason?: "component_not_found" | "invalid_status" | "invalid_scope" | "content_required";
}

export interface PromptComponentDiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
}

export interface PromptComponentDiffRecord {
  from: PromptComponentListItem;
  to: PromptComponentListItem;
  lines: PromptComponentDiffLine[];
}

export interface PromptComponentMetricsRunRef {
  runId: string;
  taskIdentifier: string;
  repositorySlug: string;
  roleKey: string;
  status: string;
  tokenTotal?: number;
  costUsd?: number;
  createdAt: Date;
  finishedAt?: Date;
}

export interface PromptComponentMetricsRecord {
  componentId: string;
  releaseCount: number;
  runCount: number;
  succeededRunCount: number;
  failedRunCount: number;
  blockedRunCount: number;
  successRate: number;
  tokenTotal: number;
  costUsd: number;
  firstUsedAt?: Date;
  lastUsedAt?: Date;
  recentRuns: PromptComponentMetricsRunRef[];
}

interface RunPromptReleaseRow {
  run_id: string;
  prompt_release_id: string | null;
  task_id: string;
  task_identifier: string;
  task_title: string;
  task_state: string;
  repository_id: string;
  repository_slug: string;
  role_id: string;
  role_key: string;
  agent_definition_id: string;
  agent_name: string;
  team_id: string;
  project_id: string;
}

interface PromptComponentRow {
  id: string;
  scope_type: PromptScope;
  name: string;
  version: number;
  content: string;
  order_index: number;
}

interface ExistingPromptReleaseRow {
  id: string;
  task_id: string;
  repository_id: string;
  role_id: string;
  agent_definition_id: string;
  content_hash: string;
  rendered_content: string;
  component_ids: string[];
}

interface PromptReleaseListRow {
  id: string;
  task_identifier: string;
  repository_slug: string;
  role_key: string;
  agent_name: string;
  content_hash: string;
  component_count: string;
  created_at: Date;
}

interface PromptReleaseDetailRow {
  id: string;
  task_id: string;
  task_identifier: string;
  task_title: string;
  repository_id: string;
  repository_slug: string;
  role_id: string;
  role_key: string;
  agent_definition_id: string;
  agent_name: string;
  content_hash: string;
  rendered_content: string;
  created_at: Date;
}

interface PromptReleaseComponentDetailRow {
  prompt_component_id: string;
  scope_type: PromptScope;
  name: string;
  version: number;
  order_index: number;
  content_hash: string;
  content: string;
}

interface PromptReleaseRunRefRow {
  run_id: string;
  status: string;
  attempt: number;
  created_at: Date;
}

interface PromptComponentListRow {
  id: string;
  scope_type: PromptScope;
  scope_id: string | null;
  name: string;
  version: number;
  status: string;
  content: string;
  changelog: string | null;
  author: string | null;
  bound_count: string;
  created_at: Date;
  updated_at: Date;
}

interface PromptComponentContentRow extends PromptComponentListRow {
  content: string;
}

interface PromptComponentMutationRow {
  id: string;
}

interface PromptComponentMetricsRow {
  release_count: string;
  run_count: string;
  succeeded_run_count: string;
  failed_run_count: string;
  blocked_run_count: string;
  token_total: string | null;
  cost_usd: string | null;
  first_used_at: Date | null;
  last_used_at: Date | null;
}

interface PromptComponentMetricsRunRow {
  run_id: string;
  task_identifier: string;
  repository_slug: string;
  role_key: string;
  status: string;
  token_total: string | null;
  cost_usd: string | null;
  created_at: Date;
  finished_at: Date | null;
}

export async function createPromptReleaseForRun(
  client: DatabaseClient,
  runId: string,
): Promise<PromptReleaseRecord> {
  const context = await fetchRunPromptContext(client, runId);
  if (context.prompt_release_id) {
    return fetchPromptRelease(client, context.prompt_release_id, runId);
  }

  const components = await fetchPromptComponentsForRun(client, context);
  const rendered = renderPrompt({
    components,
    taskContext: buildTaskContext(context),
    commentsAndWorkpad: await fetchUnresolvedFeedback(client, context.task_id),
    runtimeConstraints: "使用中文回复。所有时间使用 UTC-7。执行进度必须可追踪。",
  });
  const releaseId = randomUUID();
  const contentHash = sha256(rendered.content);

  await client.query(
    `
      insert into prompt_releases (
        id,
        task_id,
        repository_id,
        role_id,
        agent_definition_id,
        content_hash,
        rendered_content,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, now())
    `,
    [
      releaseId,
      context.task_id,
      context.repository_id,
      context.role_id,
      context.agent_definition_id,
      contentHash,
      rendered.content,
    ],
  );

  for (const [index, component] of components.entries()) {
    await client.query(
      `
        insert into prompt_release_components (
          id,
          prompt_release_id,
          prompt_component_id,
          order_index,
          content_hash
        )
        values (gen_random_uuid(), $1, $2, $3, $4)
      `,
      [releaseId, component.id, index, sha256(component.content)],
    );
  }

  await client.query(
    `
      update runs
      set prompt_release_id = $2, updated_at = now()
      where id = $1
    `,
    [runId, releaseId],
  );

  return {
    id: releaseId,
    runId,
    taskId: context.task_id,
    repositoryId: context.repository_id,
    roleId: context.role_id,
    agentDefinitionId: context.agent_definition_id,
    contentHash,
    renderedContent: rendered.content,
    componentIds: rendered.componentIds,
  };
}

export async function listPromptComponents(
  client: DatabaseClient,
  filter: PromptComponentListFilter = {},
): Promise<PromptComponentListItem[]> {
  const result = await client.query<PromptComponentListRow>(
    `
      select
        prompt_components.id,
        prompt_components.scope_type,
        prompt_components.scope_id,
        prompt_components.name,
        prompt_components.version,
        prompt_components.status,
        prompt_components.content,
        prompt_components.changelog,
        prompt_components.author,
        count(prompt_bindings.id)::text as bound_count,
        prompt_components.created_at,
        prompt_components.updated_at
      from prompt_components
      left join prompt_bindings
        on prompt_bindings.prompt_component_id = prompt_components.id
        and prompt_bindings.status::text = 'active'
      where ($1::text is null or prompt_components.scope_type::text = $1)
        and ($2::text is null or prompt_components.status::text = $2)
      group by prompt_components.id
      order by
        prompt_components.scope_type asc,
        prompt_components.name asc,
        prompt_components.version desc
      limit $3
    `,
    [filter.scope ?? null, filter.status ?? null, clampLimit(filter.limit ?? 100)],
  );

  return result.rows.map(mapPromptComponentListRow);
}

export async function getPromptComponentDetail(
  client: DatabaseClient,
  componentId: string,
): Promise<PromptComponentDetailRecord | undefined> {
  const result = await client.query<PromptComponentContentRow>(
    `${promptComponentSelectSql("where prompt_components.id = $1")} limit 1`,
    [componentId],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  const versions = await listPromptComponentVersions(client, {
    scope: row.scope_type,
    name: row.name,
    ...(row.scope_id ? { scopeId: row.scope_id } : {}),
  });
  return {
    ...mapPromptComponentListRow(row),
    content: row.content,
    versions,
  };
}

export async function createPromptComponentVersion(
  client: DatabaseClient,
  input: CreatePromptComponentVersionInput,
): Promise<PromptComponentDetailRecord> {
  if (!input.content.trim()) {
    throw new Error("Prompt component content is required");
  }

  const nextVersion = await fetchNextPromptComponentVersion(client, input);
  const result = await client.query<PromptComponentMutationRow>(
    `
      insert into prompt_components (
        id,
        scope_type,
        scope_id,
        name,
        version,
        status,
        content,
        changelog,
        author,
        created_at,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now(), now())
      returning id
    `,
    [
      input.scope,
      input.scopeId ?? null,
      input.name.trim(),
      nextVersion,
      input.status ?? "draft",
      input.content,
      input.changelog ?? null,
      input.author ?? null,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to create prompt component version");
  }

  if (input.status === "active") {
    await activatePromptComponentVersion(client, id);
  }

  const detail = await getPromptComponentDetail(client, id);
  if (!detail) {
    throw new Error(`Prompt component not found after create: ${id}`);
  }

  return detail;
}

export async function archivePromptComponent(
  client: DatabaseClient,
  componentId: string,
): Promise<PromptComponentMutationResult> {
  const result = await client.query<PromptComponentMutationRow>(
    `
      update prompt_components
      set status = 'archived', updated_at = now()
      where id = $1
      returning id
    `,
    [componentId],
  );

  if (!result.rows[0]) {
    return {
      updated: false,
      reason: "component_not_found",
    };
  }

  return {
    updated: true,
    componentId,
  };
}

export async function activatePromptComponentVersion(
  client: DatabaseClient,
  componentId: string,
): Promise<PromptComponentMutationResult> {
  const component = await getPromptComponentDetail(client, componentId);
  if (!component) {
    return {
      updated: false,
      reason: "component_not_found",
    };
  }

  await client.query(
    `
      update prompt_components
      set
        status = case when id = $1 then 'active' else 'archived' end,
        updated_at = now()
      where scope_type::text = $2
        and name = $3
        and scope_id is not distinct from $4::uuid
    `,
    [componentId, component.scope, component.name, component.scopeId ?? null],
  );
  await client.query(
    `
      update prompt_bindings
      set prompt_component_id = $1, updated_at = now()
      where prompt_component_id in (
        select id
        from prompt_components
        where scope_type::text = $2
          and name = $3
          and scope_id is not distinct from $4::uuid
      )
        and status = 'active'
    `,
    [componentId, component.scope, component.name, component.scopeId ?? null],
  );
  await client.query(
    `
      insert into audit_events (
        id,
        action,
        entity_type,
        entity_id,
        message,
        payload,
        created_at
      )
      values (
        gen_random_uuid(),
        'prompt_component.activate',
        'prompt_component',
        $1,
        'Prompt component version activated.',
        jsonb_build_object('scope', $2::text, 'scopeId', $3::text, 'name', $4::text, 'version', $5::int),
        now()
      )
    `,
    [componentId, component.scope, component.scopeId ?? null, component.name, component.version],
  );

  return {
    updated: true,
    componentId,
  };
}

export async function diffPromptComponents(
  client: DatabaseClient,
  fromComponentId: string,
  toComponentId: string,
): Promise<PromptComponentDiffRecord | undefined> {
  const [from, to] = await Promise.all([
    getPromptComponentDetail(client, fromComponentId),
    getPromptComponentDetail(client, toComponentId),
  ]);
  if (!from || !to) {
    return undefined;
  }

  return {
    from,
    to,
    lines: diffLines(from.content, to.content),
  };
}

export async function getPromptComponentMetrics(
  client: DatabaseClient,
  componentId: string,
  recentRunLimit = 10,
): Promise<PromptComponentMetricsRecord | undefined> {
  const component = await getPromptComponentDetail(client, componentId);
  if (!component) {
    return undefined;
  }

  const [summaryResult, recentRuns] = await Promise.all([
    client.query<PromptComponentMetricsRow>(
      `
        select
          count(distinct prompt_releases.id)::text as release_count,
          count(distinct runs.id)::text as run_count,
          count(distinct runs.id) filter (where runs.status = 'succeeded')::text as succeeded_run_count,
          count(distinct runs.id) filter (where runs.status in ('failed', 'stalled', 'canceled'))::text as failed_run_count,
          count(distinct runs.id) filter (where runs.status = 'blocked')::text as blocked_run_count,
          coalesce(sum(runs.token_total), 0)::text as token_total,
          coalesce(sum(runs.cost_usd), 0)::text as cost_usd,
          min(runs.created_at) as first_used_at,
          max(runs.created_at) as last_used_at
        from prompt_release_components
        join prompt_releases
          on prompt_releases.id = prompt_release_components.prompt_release_id
        left join runs
          on runs.prompt_release_id = prompt_releases.id
        where prompt_release_components.prompt_component_id = $1
      `,
      [componentId],
    ),
    listPromptComponentRecentRuns(client, componentId, recentRunLimit),
  ]);
  const summary = summaryResult.rows[0];
  if (!summary) {
    return undefined;
  }

  const runCount = parseInteger(summary.run_count);
  const succeededRunCount = parseInteger(summary.succeeded_run_count);
  return {
    componentId,
    releaseCount: parseInteger(summary.release_count),
    runCount,
    succeededRunCount,
    failedRunCount: parseInteger(summary.failed_run_count),
    blockedRunCount: parseInteger(summary.blocked_run_count),
    successRate: runCount > 0 ? succeededRunCount / runCount : 0,
    tokenTotal: parseInteger(summary.token_total ?? "0"),
    costUsd: parseDecimal(summary.cost_usd),
    ...(summary.first_used_at ? { firstUsedAt: summary.first_used_at } : {}),
    ...(summary.last_used_at ? { lastUsedAt: summary.last_used_at } : {}),
    recentRuns,
  };
}

export async function listPromptReleases(
  client: DatabaseClient,
  limit = 50,
): Promise<PromptReleaseListItem[]> {
  const result = await client.query<PromptReleaseListRow>(
    `
      select
        prompt_releases.id,
        tasks.identifier as task_identifier,
        repositories.slug as repository_slug,
        roles.key as role_key,
        agent_definitions.name as agent_name,
        prompt_releases.content_hash,
        count(prompt_release_components.id)::text as component_count,
        prompt_releases.created_at
      from prompt_releases
      join tasks on tasks.id = prompt_releases.task_id
      join repositories on repositories.id = prompt_releases.repository_id
      join roles on roles.id = prompt_releases.role_id
      join agent_definitions on agent_definitions.id = prompt_releases.agent_definition_id
      left join prompt_release_components
        on prompt_release_components.prompt_release_id = prompt_releases.id
      group by
        prompt_releases.id,
        tasks.identifier,
        repositories.slug,
        roles.key,
        agent_definitions.name,
        prompt_releases.content_hash,
        prompt_releases.created_at
      order by prompt_releases.created_at desc
      limit $1
    `,
    [clampLimit(limit)],
  );

  return result.rows.map((row) => ({
    id: row.id,
    taskIdentifier: row.task_identifier,
    repositorySlug: row.repository_slug,
    roleKey: row.role_key,
    agentName: row.agent_name,
    contentHash: row.content_hash,
    componentCount: Number.parseInt(row.component_count, 10),
    createdAt: row.created_at,
  }));
}

export async function getPromptReleaseDetail(
  client: DatabaseClient,
  promptReleaseId: string,
): Promise<PromptReleaseDetailRecord | undefined> {
  const result = await client.query<PromptReleaseDetailRow>(
    `
      select
        prompt_releases.id,
        prompt_releases.task_id,
        tasks.identifier as task_identifier,
        tasks.title as task_title,
        prompt_releases.repository_id,
        repositories.slug as repository_slug,
        prompt_releases.role_id,
        roles.key as role_key,
        prompt_releases.agent_definition_id,
        agent_definitions.name as agent_name,
        prompt_releases.content_hash,
        prompt_releases.rendered_content,
        prompt_releases.created_at
      from prompt_releases
      join tasks on tasks.id = prompt_releases.task_id
      join repositories on repositories.id = prompt_releases.repository_id
      join roles on roles.id = prompt_releases.role_id
      join agent_definitions on agent_definitions.id = prompt_releases.agent_definition_id
      where prompt_releases.id = $1
      limit 1
    `,
    [promptReleaseId],
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  const [components, runs] = await Promise.all([
    listPromptReleaseComponents(client, promptReleaseId),
    listPromptReleaseRuns(client, promptReleaseId),
  ]);

  return {
    id: row.id,
    taskId: row.task_id,
    taskIdentifier: row.task_identifier,
    taskTitle: row.task_title,
    repositoryId: row.repository_id,
    repositorySlug: row.repository_slug,
    roleId: row.role_id,
    roleKey: row.role_key,
    agentDefinitionId: row.agent_definition_id,
    agentName: row.agent_name,
    contentHash: row.content_hash,
    renderedContent: row.rendered_content,
    createdAt: row.created_at,
    components,
    runs,
  };
}

async function listPromptReleaseComponents(
  client: DatabaseClient,
  promptReleaseId: string,
): Promise<PromptReleaseComponentDetail[]> {
  const result = await client.query<PromptReleaseComponentDetailRow>(
    `
      select
        prompt_release_components.prompt_component_id,
        prompt_components.scope_type,
        prompt_components.name,
        prompt_components.version,
        prompt_release_components.order_index,
        prompt_release_components.content_hash,
        prompt_components.content
      from prompt_release_components
      join prompt_components
        on prompt_components.id = prompt_release_components.prompt_component_id
      where prompt_release_components.prompt_release_id = $1
      order by prompt_release_components.order_index asc
    `,
    [promptReleaseId],
  );

  return result.rows.map((row) => ({
    promptComponentId: row.prompt_component_id,
    scope: row.scope_type,
    name: row.name,
    version: row.version,
    orderIndex: row.order_index,
    contentHash: row.content_hash,
    content: row.content,
  }));
}

async function listPromptReleaseRuns(
  client: DatabaseClient,
  promptReleaseId: string,
): Promise<PromptReleaseRunRef[]> {
  const result = await client.query<PromptReleaseRunRefRow>(
    `
      select id as run_id, status, attempt, created_at
      from runs
      where prompt_release_id = $1
      order by created_at desc
    `,
    [promptReleaseId],
  );

  return result.rows.map((row) => ({
    runId: row.run_id,
    status: row.status,
    attempt: row.attempt,
    createdAt: row.created_at,
  }));
}

async function listPromptComponentRecentRuns(
  client: DatabaseClient,
  componentId: string,
  limit: number,
): Promise<PromptComponentMetricsRunRef[]> {
  const result = await client.query<PromptComponentMetricsRunRow>(
    `
      select
        runs.id as run_id,
        tasks.identifier as task_identifier,
        repositories.slug as repository_slug,
        roles.key as role_key,
        runs.status,
        runs.token_total::text,
        runs.cost_usd::text,
        runs.created_at,
        runs.finished_at
      from prompt_release_components
      join prompt_releases
        on prompt_releases.id = prompt_release_components.prompt_release_id
      join runs
        on runs.prompt_release_id = prompt_releases.id
      join tasks
        on tasks.id = runs.task_id
      join repositories
        on repositories.id = runs.repository_id
      join roles
        on roles.id = runs.role_id
      where prompt_release_components.prompt_component_id = $1
      order by runs.created_at desc
      limit $2
    `,
    [componentId, clampLimit(limit)],
  );

  return result.rows.map((row) => ({
    runId: row.run_id,
    taskIdentifier: row.task_identifier,
    repositorySlug: row.repository_slug,
    roleKey: row.role_key,
    status: row.status,
    ...(row.token_total ? { tokenTotal: parseInteger(row.token_total) } : {}),
    ...(row.cost_usd ? { costUsd: parseDecimal(row.cost_usd) } : {}),
    createdAt: row.created_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  }));
}

async function fetchRunPromptContext(
  client: DatabaseClient,
  runId: string,
): Promise<RunPromptReleaseRow> {
  const result = await client.query<RunPromptReleaseRow>(
    `
      select
        runs.id as run_id,
        runs.prompt_release_id,
        tasks.id as task_id,
        tasks.identifier as task_identifier,
        tasks.title as task_title,
        tasks.state as task_state,
        repositories.id as repository_id,
        repositories.slug as repository_slug,
        roles.id as role_id,
        roles.key as role_key,
        agent_definitions.id as agent_definition_id,
        agent_definitions.name as agent_name,
        teams.id as team_id,
        projects.id as project_id
      from runs
      join tasks on tasks.id = runs.task_id
      join repositories on repositories.id = runs.repository_id
      join roles on roles.id = runs.role_id
      join agent_definitions on agent_definitions.id = runs.agent_definition_id
      join projects on projects.id = tasks.project_id
      join teams on teams.id = projects.team_id
      where runs.id = $1
      limit 1
    `,
    [runId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Run not found for prompt release: ${runId}`);
  }

  return row;
}

async function fetchPromptComponentsForRun(
  client: DatabaseClient,
  context: RunPromptReleaseRow,
): Promise<PromptComponent[]> {
  const result = await client.query<PromptComponentRow>(
    `
      select
        prompt_components.id,
        prompt_components.scope_type,
        prompt_components.name,
        prompt_components.version,
        prompt_components.content,
        prompt_bindings.order_index
      from prompt_bindings
      join prompt_components on prompt_components.id = prompt_bindings.prompt_component_id
      where prompt_bindings.status::text = 'active'
        and prompt_components.status::text = 'active'
        and prompt_bindings.environment = 'dev'
        and (
          (prompt_bindings.scope_type = 'team' and prompt_bindings.scope_id = $1)
          or (prompt_bindings.scope_type = 'project' and prompt_bindings.scope_id = $2)
          or (prompt_bindings.scope_type = 'repo' and prompt_bindings.scope_id = $3)
          or (prompt_bindings.scope_type = 'role' and prompt_bindings.scope_id = $4)
          or (prompt_bindings.scope_type = 'agent' and prompt_bindings.scope_id = $5)
        )
      order by prompt_bindings.order_index asc, prompt_components.name asc
    `,
    [
      context.team_id,
      context.project_id,
      context.repository_id,
      context.role_id,
      context.agent_definition_id,
    ],
  );

  return result.rows.map((row) => ({
    id: row.id,
    scope: row.scope_type,
    name: row.name,
    version: row.version,
    content: row.content,
    order: row.order_index,
  }));
}

async function fetchUnresolvedFeedback(client: DatabaseClient, taskId: string): Promise<string> {
  const result = await client.query<{ body: string }>(
    `
      select body
      from feedback_items
      where task_id = $1
        and resolved_at is null
      order by created_at asc
    `,
    [taskId],
  );

  return result.rows.map((row) => `- ${row.body}`).join("\n");
}

async function fetchPromptRelease(
  client: DatabaseClient,
  promptReleaseId: string,
  runId?: string,
): Promise<PromptReleaseRecord> {
  const result = await client.query<ExistingPromptReleaseRow>(
    `
      select
        prompt_releases.id,
        prompt_releases.task_id,
        prompt_releases.repository_id,
        prompt_releases.role_id,
        prompt_releases.agent_definition_id,
        prompt_releases.content_hash,
        prompt_releases.rendered_content,
        coalesce(array_agg(prompt_release_components.prompt_component_id order by prompt_release_components.order_index) filter (where prompt_release_components.id is not null), '{}') as component_ids
      from prompt_releases
      left join prompt_release_components
        on prompt_release_components.prompt_release_id = prompt_releases.id
      where prompt_releases.id = $1
      group by prompt_releases.id
    `,
    [promptReleaseId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Prompt release not found: ${promptReleaseId}`);
  }

  const record: PromptReleaseRecord = {
    id: row.id,
    taskId: row.task_id,
    repositoryId: row.repository_id,
    roleId: row.role_id,
    agentDefinitionId: row.agent_definition_id,
    contentHash: row.content_hash,
    renderedContent: row.rendered_content,
    componentIds: row.component_ids,
  };

  if (runId) {
    record.runId = runId;
  }

  return record;
}

function buildTaskContext(context: RunPromptReleaseRow): string {
  return [
    `Task: ${context.task_identifier} ${context.task_title}`,
    `State: ${context.task_state}`,
    `Repository: ${context.repository_slug}`,
    `Role: ${context.role_key}`,
    `Agent: ${context.agent_name}`,
  ].join("\n");
}

function mapPromptComponentListRow(row: PromptComponentListRow): PromptComponentListItem {
  const item: PromptComponentListItem = {
    id: row.id,
    scope: row.scope_type,
    name: row.name,
    version: row.version,
    status: normalizePromptComponentStatus(row.status),
    contentHash: sha256(row.content),
    boundCount: Number.parseInt(row.bound_count, 10),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.scope_id) {
    item.scopeId = row.scope_id;
  }

  if (row.author) {
    item.author = row.author;
  }

  if (row.changelog) {
    item.changelog = row.changelog;
  }

  return item;
}

function promptComponentSelectSql(whereClause: string): string {
  return `
    select
      prompt_components.id,
      prompt_components.scope_type,
      prompt_components.scope_id,
      prompt_components.name,
      prompt_components.version,
      prompt_components.status,
      prompt_components.content,
      prompt_components.changelog,
      prompt_components.author,
      count(prompt_bindings.id)::text as bound_count,
      prompt_components.created_at,
      prompt_components.updated_at
    from prompt_components
    left join prompt_bindings
      on prompt_bindings.prompt_component_id = prompt_components.id
      and prompt_bindings.status::text = 'active'
    ${whereClause}
    group by prompt_components.id
  `;
}

async function listPromptComponentVersions(
  client: DatabaseClient,
  input: Pick<CreatePromptComponentVersionInput, "scope" | "scopeId" | "name">,
): Promise<PromptComponentListItem[]> {
  const result = await client.query<PromptComponentListRow>(
    `${promptComponentSelectSql(`
      where prompt_components.scope_type::text = $1
        and prompt_components.scope_id is not distinct from $2::uuid
        and prompt_components.name = $3
    `)}
    order by prompt_components.version desc`,
    [input.scope, input.scopeId ?? null, input.name],
  );

  return result.rows.map(mapPromptComponentListRow);
}

async function fetchNextPromptComponentVersion(
  client: DatabaseClient,
  input: Pick<CreatePromptComponentVersionInput, "scope" | "scopeId" | "name">,
): Promise<number> {
  const result = await client.query<{ next_version: number }>(
    `
      select coalesce(max(version), 0) + 1 as next_version
      from prompt_components
      where scope_type::text = $1
        and scope_id is not distinct from $2::uuid
        and name = $3
    `,
    [input.scope, input.scopeId ?? null, input.name.trim()],
  );

  return result.rows[0]?.next_version ?? 1;
}

function normalizePromptComponentStatus(value: string): PromptComponentStatus {
  if (value === "active" || value === "archived" || value === "draft") {
    return value;
  }

  return "draft";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDecimal(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function diffLines(from: string, to: string): PromptComponentDiffLine[] {
  const fromLines = from.split("\n");
  const toLines = to.split("\n");
  const table = Array.from({ length: fromLines.length + 1 }, () =>
    Array<number>(toLines.length + 1).fill(0),
  );

  for (let i = fromLines.length - 1; i >= 0; i -= 1) {
    for (let j = toLines.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        fromLines[i] === toLines[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: PromptComponentDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < fromLines.length && j < toLines.length) {
    if (fromLines[i] === toLines[j]) {
      lines.push({ type: "unchanged", content: fromLines[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ type: "removed", content: fromLines[i]! });
      i += 1;
    } else {
      lines.push({ type: "added", content: toLines[j]! });
      j += 1;
    }
  }

  while (i < fromLines.length) {
    lines.push({ type: "removed", content: fromLines[i]! });
    i += 1;
  }

  while (j < toLines.length) {
    lines.push({ type: "added", content: toLines[j]! });
    j += 1;
  }

  return lines;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}
