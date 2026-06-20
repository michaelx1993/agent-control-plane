import { type PromptScope } from "@agent-control-plane/core";
import type { DatabaseClient } from "./client.js";
import type { PromptComponentStatus } from "./prompts.js";

export type PromptBindingScope = Exclude<PromptScope, "global">;
export type PromptBindingStatus = "pending" | "active" | "disabled" | "rejected";

export interface SettingsAuditActor {
  userId?: string;
  name: string;
  roles: string[];
}

export interface ProjectSettingsSnapshot {
  teams: TeamSettingsRecord[];
  projects: ProjectSettingsRecord[];
  repositories: RepositorySettingsRecord[];
  roles: RoleSettingsRecord[];
  agentDefinitions: AgentDefinitionSettingsRecord[];
}

export interface TeamSettingsRecord {
  id: string;
  key: string;
  name: string;
  description?: string;
}

export interface ProjectSettingsRecord {
  id: string;
  teamId: string;
  teamKey: string;
  slug: string;
  name: string;
  description?: string;
  status: string;
}

export interface RepositorySettingsRecord {
  id: string;
  projectId: string;
  projectSlug: string;
  slug: string;
  gitUrl: string;
  defaultBranch: string;
  localPath?: string;
  status: string;
  description?: string;
}

export interface RoleSettingsRecord {
  id: string;
  key: string;
  name: string;
  activeStates: string[];
  nextStates: string[];
  status: string;
  description?: string;
}

export interface AgentDefinitionSettingsRecord {
  id: string;
  roleId: string;
  roleKey: string;
  name: string;
  runtime: string;
  model: string;
  reasoningEffort: string;
  toolProfile: string;
  maxTurns: number;
  timeoutSeconds: number;
  status: string;
}

export interface PromptBindingRecord {
  id: string;
  scope: PromptBindingScope;
  scopeId: string;
  scopeName: string;
  promptComponentId: string;
  promptComponentName: string;
  promptComponentVersion: number;
  promptComponentStatus: PromptComponentStatus;
  orderIndex: number;
  environment: string;
  status: PromptBindingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptBindingAuditRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  bindingId: string;
  actorName?: string;
  message: string;
  status?: string;
  createdAt: Date;
}

export interface AuditEventFilters {
  entityType?: string;
  action?: string;
  actor?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
}

export interface AuditEventCountRecord {
  key: string;
  count: number;
}

export interface AuditEventSummary {
  totalEvents: number;
  uniqueActors: number;
  firstEventAt?: Date;
  lastEventAt?: Date;
  actionCounts: AuditEventCountRecord[];
  entityTypeCounts: AuditEventCountRecord[];
  actorCounts: AuditEventCountRecord[];
}

export interface CreatePromptBindingInput {
  scope: PromptBindingScope;
  scopeId: string;
  promptComponentId: string;
  orderIndex: number;
  environment?: string;
  actor?: SettingsAuditActor;
}

export interface PromptBindingMutationResult {
  updated: boolean;
  bindingId?: string;
  reason?:
    | "binding_not_found"
    | "scope_not_found"
    | "component_not_found"
    | "invalid_scope"
    | "invalid_status";
}

export interface UpdateRepositorySettingsInput {
  repositoryId: string;
  slug: string;
  gitUrl: string;
  defaultBranch: string;
  localPath?: string;
  status: string;
  description?: string;
}

export interface CreateRepositorySettingsInput {
  projectId: string;
  slug: string;
  gitUrl: string;
  defaultBranch: string;
  localPath?: string;
  status?: string;
  description?: string;
}

export interface UpdateRoleSettingsInput {
  roleId: string;
  name: string;
  activeStates: string[];
  nextStates: string[];
  status: string;
  description?: string;
}

export interface CreateRoleSettingsInput {
  key: string;
  name: string;
  activeStates: string[];
  nextStates: string[];
  status?: string;
  description?: string;
}

export interface UpdateAgentDefinitionSettingsInput {
  agentDefinitionId: string;
  name: string;
  runtime: string;
  model: string;
  reasoningEffort: string;
  toolProfile: string;
  maxTurns: number;
  timeoutSeconds: number;
  status: string;
}

export interface CreateAgentDefinitionSettingsInput {
  roleId: string;
  name: string;
  runtime: string;
  model: string;
  reasoningEffort: string;
  toolProfile: string;
  maxTurns: number;
  timeoutSeconds: number;
  status?: string;
}

export interface SettingsMutationResult {
  updated: boolean;
  id?: string;
  reason?: "not_found" | "invalid_input";
}

interface TeamSettingsRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

interface ProjectSettingsRow {
  id: string;
  team_id: string;
  team_key: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
}

interface RepositorySettingsRow {
  id: string;
  project_id: string;
  project_slug: string;
  slug: string;
  git_url: string;
  default_branch: string;
  local_path: string | null;
  status: string;
  description: string | null;
}

interface RoleSettingsRow {
  id: string;
  key: string;
  name: string;
  active_states: string[] | string;
  next_states: string[] | string;
  status: string;
  description: string | null;
}

interface AgentDefinitionSettingsRow {
  id: string;
  role_id: string;
  role_key: string;
  name: string;
  runtime: string;
  model: string;
  reasoning_effort: string;
  tool_profile: string;
  max_turns: number;
  timeout_seconds: number;
  status: string;
}

interface PromptBindingRow {
  id: string;
  scope_type: PromptBindingScope;
  scope_id: string;
  scope_name: string;
  prompt_component_id: string;
  prompt_component_name: string;
  prompt_component_version: number;
  prompt_component_status: PromptComponentStatus;
  order_index: number;
  environment: string;
  status: PromptBindingStatus;
  created_at: Date;
  updated_at: Date;
}

interface MutationIdRow {
  id: string;
}

interface PromptBindingStatusRow {
  id: string;
  status: PromptBindingStatus;
}

interface PromptBindingAuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  message: string;
  payload: {
    status?: string;
  } | null;
  created_at: Date;
}

export async function getProjectSettingsSnapshot(
  client: DatabaseClient,
): Promise<ProjectSettingsSnapshot> {
  const [teams, projects, repositories, roles, agentDefinitions] = await Promise.all([
    listTeamsForSettings(client),
    listProjectsForSettings(client),
    listRepositoriesForSettings(client),
    listRolesForSettings(client),
    listAgentDefinitionsForSettings(client),
  ]);

  return {
    teams,
    projects,
    repositories,
    roles,
    agentDefinitions,
  };
}

export async function listPromptBindings(client: DatabaseClient): Promise<PromptBindingRecord[]> {
  const result = await client.query<PromptBindingRow>(
    `
      select
        prompt_bindings.id,
        prompt_bindings.scope_type,
        prompt_bindings.scope_id,
        coalesce(
          teams.name,
          projects.slug,
          repositories.slug,
          roles.key,
          agent_definitions.name,
          prompt_bindings.scope_id::text
        ) as scope_name,
        prompt_components.id as prompt_component_id,
        prompt_components.name as prompt_component_name,
        prompt_components.version as prompt_component_version,
        prompt_components.status as prompt_component_status,
        prompt_bindings.order_index,
        prompt_bindings.environment,
        prompt_bindings.status,
        prompt_bindings.created_at,
        prompt_bindings.updated_at
      from prompt_bindings
      join prompt_components on prompt_components.id = prompt_bindings.prompt_component_id
      left join teams
        on prompt_bindings.scope_type = 'team'
        and teams.id = prompt_bindings.scope_id
      left join projects
        on prompt_bindings.scope_type = 'project'
        and projects.id = prompt_bindings.scope_id
      left join repositories
        on prompt_bindings.scope_type = 'repo'
        and repositories.id = prompt_bindings.scope_id
      left join roles
        on prompt_bindings.scope_type = 'role'
        and roles.id = prompt_bindings.scope_id
      left join agent_definitions
        on prompt_bindings.scope_type = 'agent'
        and agent_definitions.id = prompt_bindings.scope_id
      order by prompt_bindings.environment asc, prompt_bindings.order_index asc, scope_name asc
    `,
  );

  return result.rows.map(mapPromptBindingRow);
}

export async function listPromptBindingAuditEvents(
  client: DatabaseClient,
  limit = 20,
): Promise<PromptBindingAuditRecord[]> {
  return listAuditEvents(client, { entityType: "prompt_binding", limit });
}

export async function listAuditEvents(
  client: DatabaseClient,
  filters: AuditEventFilters = {},
): Promise<PromptBindingAuditRecord[]> {
  const boundedLimit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const { whereClause, values } = buildAuditEventWhereClause(filters);

  values.push(boundedLimit);
  const limitParameter = `$${values.length}`;
  const result = await client.query<PromptBindingAuditRow>(
    `
      select
        audit_events.id,
        audit_events.action,
        audit_events.entity_type,
        audit_events.entity_id,
        coalesce(users.name, audit_events.payload->'actor'->>'name') as actor_name,
        audit_events.message,
        audit_events.payload,
        audit_events.created_at
      from audit_events
      left join users on users.id = audit_events.actor_user_id
      ${whereClause}
      order by audit_events.created_at desc
      limit ${limitParameter}
    `,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    bindingId: row.entity_id,
    ...(row.actor_name ? { actorName: row.actor_name } : {}),
    message: row.message,
    ...(row.payload?.status ? { status: row.payload.status } : {}),
    createdAt: row.created_at,
  }));
}

interface AuditEventSummaryRow {
  total_events: string | number;
  unique_actors: string | number;
  first_event_at: Date | null;
  last_event_at: Date | null;
}

interface AuditEventCountRow {
  key: string | null;
  count: string | number;
}

export async function getAuditEventSummary(
  client: DatabaseClient,
  filters: AuditEventFilters = {},
): Promise<AuditEventSummary> {
  const { whereClause, values } = buildAuditEventWhereClause(filters);
  const limit = Math.min(Math.max(filters.limit ?? 10, 1), 100);
  const summaryResult = await client.query<AuditEventSummaryRow>(
    `
      select
        count(*) as total_events,
        count(distinct coalesce(users.name, audit_events.payload->'actor'->>'name', 'unknown')) as unique_actors,
        min(audit_events.created_at) as first_event_at,
        max(audit_events.created_at) as last_event_at
      from audit_events
      left join users on users.id = audit_events.actor_user_id
      ${whereClause}
    `,
    values,
  );
  const [actionCounts, entityTypeCounts, actorCounts] = await Promise.all([
    queryAuditEventCounts(client, "audit_events.action", whereClause, values, limit),
    queryAuditEventCounts(client, "audit_events.entity_type", whereClause, values, limit),
    queryAuditEventCounts(
      client,
      "coalesce(users.name, audit_events.payload->'actor'->>'name', 'unknown')",
      whereClause,
      values,
      limit,
    ),
  ]);
  const row = summaryResult.rows[0];

  return {
    totalEvents: row ? numberFromPg(row.total_events) : 0,
    uniqueActors: row ? numberFromPg(row.unique_actors) : 0,
    ...(row?.first_event_at ? { firstEventAt: row.first_event_at } : {}),
    ...(row?.last_event_at ? { lastEventAt: row.last_event_at } : {}),
    actionCounts,
    entityTypeCounts,
    actorCounts,
  };
}

async function queryAuditEventCounts(
  client: DatabaseClient,
  expression: string,
  whereClause: string,
  values: unknown[],
  limit: number,
): Promise<AuditEventCountRecord[]> {
  const result = await client.query<AuditEventCountRow>(
    `
      select
        ${expression} as key,
        count(*) as count
      from audit_events
      left join users on users.id = audit_events.actor_user_id
      ${whereClause}
      group by key
      order by count(*) desc, key asc
      limit $${values.length + 1}
    `,
    [...values, limit],
  );

  return result.rows.map((row) => ({
    key: row.key ?? "unknown",
    count: numberFromPg(row.count),
  }));
}

function buildAuditEventWhereClause(filters: AuditEventFilters): {
  whereClause: string;
  values: unknown[];
} {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.entityType?.trim()) {
    values.push(filters.entityType.trim());
    conditions.push(`audit_events.entity_type = $${values.length}`);
  }

  if (filters.action?.trim()) {
    values.push(filters.action.trim());
    conditions.push(`audit_events.action = $${values.length}`);
  }

  if (filters.actor?.trim()) {
    values.push(`%${filters.actor.trim()}%`);
    conditions.push(
      `(users.name ilike $${values.length} or audit_events.payload->'actor'->>'name' ilike $${values.length})`,
    );
  }

  if (filters.createdAfter) {
    values.push(filters.createdAfter);
    conditions.push(`audit_events.created_at >= $${values.length}`);
  }

  if (filters.createdBefore) {
    values.push(filters.createdBefore);
    conditions.push(`audit_events.created_at <= $${values.length}`);
  }

  return {
    whereClause: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "",
    values,
  };
}

function numberFromPg(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

export async function createPromptBinding(
  client: DatabaseClient,
  input: CreatePromptBindingInput,
): Promise<PromptBindingMutationResult> {
  if (!(await scopeExists(client, input.scope, input.scopeId))) {
    return {
      updated: false,
      reason: "scope_not_found",
    };
  }

  if (!(await promptComponentExists(client, input.promptComponentId))) {
    return {
      updated: false,
      reason: "component_not_found",
    };
  }

  const requestedStatus: PromptBindingStatus = "pending";
  const result = await client.query<MutationIdRow>(
    `
      insert into prompt_bindings (
        id,
        scope_type,
        scope_id,
        prompt_component_id,
        order_index,
        environment,
        status,
        created_at,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now())
      returning id
    `,
    [
      input.scope,
      input.scopeId,
      input.promptComponentId,
      input.orderIndex,
      input.environment ?? "dev",
      requestedStatus,
    ],
  );

  const bindingId = result.rows[0]?.id;
  if (!bindingId) {
    return {
      updated: false,
    };
  }

  await insertPromptBindingAuditEvent(client, {
    bindingId,
    action: "prompt_binding.request",
    message: "Prompt binding approval requested.",
    status: requestedStatus,
    ...(input.actor ? { actor: input.actor } : {}),
  });

  return {
    updated: true,
    bindingId,
  };
}

export async function updatePromptBindingStatus(
  client: DatabaseClient,
  bindingId: string,
  status: PromptBindingStatus,
  actor?: SettingsAuditActor,
): Promise<PromptBindingMutationResult> {
  const result = await client.query<PromptBindingStatusRow>(
    `
      update prompt_bindings
      set status = $2, updated_at = now()
      where id = $1
      returning id, status
    `,
    [bindingId, status],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      updated: false,
      reason: "binding_not_found",
    };
  }

  await insertPromptBindingAuditEvent(client, {
    bindingId,
    action: actionForPromptBindingStatus(status),
    message: `Prompt binding status changed to ${status}.`,
    status: row.status,
    ...(actor ? { actor } : {}),
  });

  return {
    updated: true,
    bindingId,
  };
}

export async function updateRepositorySettings(
  client: DatabaseClient,
  input: UpdateRepositorySettingsInput,
): Promise<SettingsMutationResult> {
  if (!input.slug.trim() || !input.gitUrl.trim() || !input.defaultBranch.trim()) {
    return {
      updated: false,
      reason: "invalid_input",
    };
  }

  const result = await client.query<MutationIdRow>(
    `
      update repositories
      set
        slug = $2,
        git_url = $3,
        default_branch = $4,
        local_path = $5,
        status = $6,
        description = $7,
        updated_at = now()
      where id = $1
      returning id
    `,
    [
      input.repositoryId,
      input.slug.trim(),
      input.gitUrl.trim(),
      input.defaultBranch.trim(),
      input.localPath?.trim() || null,
      input.status.trim() || "active",
      input.description?.trim() || null,
    ],
  );

  const id = result.rows[0]?.id;
  if (!id) {
    return {
      updated: false,
      reason: "not_found",
    };
  }

  return {
    updated: true,
    id,
  };
}

export async function createRepositorySettings(
  client: DatabaseClient,
  input: CreateRepositorySettingsInput,
): Promise<SettingsMutationResult> {
  if (
    !input.projectId ||
    !input.slug.trim() ||
    !input.gitUrl.trim() ||
    !input.defaultBranch.trim()
  ) {
    return {
      updated: false,
      reason: "invalid_input",
    };
  }

  const result = await client.query<MutationIdRow>(
    `
      insert into repositories (
        id,
        project_id,
        slug,
        git_url,
        default_branch,
        local_path,
        status,
        description,
        created_at,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now())
      returning id
    `,
    [
      input.projectId,
      input.slug.trim(),
      input.gitUrl.trim(),
      input.defaultBranch.trim(),
      input.localPath?.trim() || null,
      input.status?.trim() || "active",
      input.description?.trim() || null,
    ],
  );

  const id = result.rows[0]?.id;
  return id ? { updated: true, id } : { updated: false };
}

export async function archiveRepositorySettings(
  client: DatabaseClient,
  repositoryId: string,
): Promise<SettingsMutationResult> {
  const result = await client.query<MutationIdRow>(
    `
      update repositories
      set status = 'archived', updated_at = now()
      where id = $1
      returning id
    `,
    [repositoryId],
  );

  const id = result.rows[0]?.id;
  return id ? { updated: true, id } : { updated: false, reason: "not_found" };
}

export async function updateRoleSettings(
  client: DatabaseClient,
  input: UpdateRoleSettingsInput,
): Promise<SettingsMutationResult> {
  const activeStates = input.activeStates.map((state) => state.trim()).filter(Boolean);
  const nextStates = input.nextStates.map((state) => state.trim()).filter(Boolean);

  if (!input.name.trim() || activeStates.length === 0 || nextStates.length === 0) {
    return {
      updated: false,
      reason: "invalid_input",
    };
  }

  const result = await client.query<MutationIdRow>(
    `
      update roles
      set
        name = $2,
        active_states = $3,
        next_states = $4,
        status = $5,
        description = $6,
        updated_at = now()
      where id = $1
      returning id
    `,
    [
      input.roleId,
      input.name.trim(),
      activeStates,
      nextStates,
      input.status.trim() || "active",
      input.description?.trim() || null,
    ],
  );

  const id = result.rows[0]?.id;
  if (!id) {
    return {
      updated: false,
      reason: "not_found",
    };
  }

  return {
    updated: true,
    id,
  };
}

export async function createRoleSettings(
  client: DatabaseClient,
  input: CreateRoleSettingsInput,
): Promise<SettingsMutationResult> {
  const activeStates = input.activeStates.map((state) => state.trim()).filter(Boolean);
  const nextStates = input.nextStates.map((state) => state.trim()).filter(Boolean);

  if (
    !input.key.trim() ||
    !input.name.trim() ||
    activeStates.length === 0 ||
    nextStates.length === 0
  ) {
    return {
      updated: false,
      reason: "invalid_input",
    };
  }

  const result = await client.query<MutationIdRow>(
    `
      insert into roles (
        id,
        key,
        name,
        active_states,
        next_states,
        status,
        description,
        created_at,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now())
      returning id
    `,
    [
      input.key.trim(),
      input.name.trim(),
      activeStates,
      nextStates,
      input.status?.trim() || "active",
      input.description?.trim() || null,
    ],
  );

  const id = result.rows[0]?.id;
  return id ? { updated: true, id } : { updated: false };
}

export async function archiveRoleSettings(
  client: DatabaseClient,
  roleId: string,
): Promise<SettingsMutationResult> {
  const result = await client.query<MutationIdRow>(
    `
      update roles
      set status = 'archived', updated_at = now()
      where id = $1
      returning id
    `,
    [roleId],
  );

  const id = result.rows[0]?.id;
  return id ? { updated: true, id } : { updated: false, reason: "not_found" };
}

export async function updateAgentDefinitionSettings(
  client: DatabaseClient,
  input: UpdateAgentDefinitionSettingsInput,
): Promise<SettingsMutationResult> {
  if (
    !input.name.trim() ||
    !input.runtime.trim() ||
    !input.model.trim() ||
    !input.reasoningEffort.trim() ||
    !input.toolProfile.trim() ||
    input.maxTurns <= 0 ||
    input.timeoutSeconds <= 0
  ) {
    return {
      updated: false,
      reason: "invalid_input",
    };
  }

  const result = await client.query<MutationIdRow>(
    `
      update agent_definitions
      set
        name = $2,
        runtime = $3,
        model = $4,
        reasoning_effort = $5,
        tool_profile = $6,
        max_turns = $7,
        timeout_seconds = $8,
        status = $9,
        updated_at = now()
      where id = $1
      returning id
    `,
    [
      input.agentDefinitionId,
      input.name.trim(),
      input.runtime.trim(),
      input.model.trim(),
      input.reasoningEffort.trim(),
      input.toolProfile.trim(),
      input.maxTurns,
      input.timeoutSeconds,
      input.status.trim() || "active",
    ],
  );

  const id = result.rows[0]?.id;
  if (!id) {
    return {
      updated: false,
      reason: "not_found",
    };
  }

  return {
    updated: true,
    id,
  };
}

export async function createAgentDefinitionSettings(
  client: DatabaseClient,
  input: CreateAgentDefinitionSettingsInput,
): Promise<SettingsMutationResult> {
  if (
    !input.roleId ||
    !input.name.trim() ||
    !input.runtime.trim() ||
    !input.model.trim() ||
    !input.reasoningEffort.trim() ||
    !input.toolProfile.trim() ||
    input.maxTurns <= 0 ||
    input.timeoutSeconds <= 0
  ) {
    return {
      updated: false,
      reason: "invalid_input",
    };
  }

  const result = await client.query<MutationIdRow>(
    `
      insert into agent_definitions (
        id,
        role_id,
        name,
        runtime,
        model,
        reasoning_effort,
        tool_profile,
        max_turns,
        timeout_seconds,
        status,
        created_at,
        updated_at
      )
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
      returning id
    `,
    [
      input.roleId,
      input.name.trim(),
      input.runtime.trim(),
      input.model.trim(),
      input.reasoningEffort.trim(),
      input.toolProfile.trim(),
      input.maxTurns,
      input.timeoutSeconds,
      input.status?.trim() || "active",
    ],
  );

  const id = result.rows[0]?.id;
  return id ? { updated: true, id } : { updated: false };
}

export async function archiveAgentDefinitionSettings(
  client: DatabaseClient,
  agentDefinitionId: string,
): Promise<SettingsMutationResult> {
  const result = await client.query<MutationIdRow>(
    `
      update agent_definitions
      set status = 'archived', updated_at = now()
      where id = $1
      returning id
    `,
    [agentDefinitionId],
  );

  const id = result.rows[0]?.id;
  return id ? { updated: true, id } : { updated: false, reason: "not_found" };
}

async function listTeamsForSettings(client: DatabaseClient): Promise<TeamSettingsRecord[]> {
  const result = await client.query<TeamSettingsRow>(
    `
      select id, key, name, description
      from teams
      order by key asc
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
  }));
}

async function listProjectsForSettings(client: DatabaseClient): Promise<ProjectSettingsRecord[]> {
  const result = await client.query<ProjectSettingsRow>(
    `
      select
        projects.id,
        projects.team_id,
        teams.key as team_key,
        projects.slug,
        projects.name,
        projects.description,
        projects.status
      from projects
      join teams on teams.id = projects.team_id
      order by teams.key asc, projects.slug asc
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    teamId: row.team_id,
    teamKey: row.team_key,
    slug: row.slug,
    name: row.name,
    status: row.status,
    ...(row.description ? { description: row.description } : {}),
  }));
}

async function listRepositoriesForSettings(
  client: DatabaseClient,
): Promise<RepositorySettingsRecord[]> {
  const result = await client.query<RepositorySettingsRow>(
    `
      select
        repositories.id,
        repositories.project_id,
        projects.slug as project_slug,
        repositories.slug,
        repositories.git_url,
        repositories.default_branch,
        repositories.local_path,
        repositories.status,
        repositories.description
      from repositories
      join projects on projects.id = repositories.project_id
      order by projects.slug asc, repositories.slug asc
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    slug: row.slug,
    gitUrl: row.git_url,
    defaultBranch: row.default_branch,
    status: row.status,
    ...(row.local_path ? { localPath: row.local_path } : {}),
    ...(row.description ? { description: row.description } : {}),
  }));
}

async function listRolesForSettings(client: DatabaseClient): Promise<RoleSettingsRecord[]> {
  const result = await client.query<RoleSettingsRow>(
    `
      select id, key, name, active_states, next_states, status, description
      from roles
      order by key asc
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    activeStates: normalizeStateList(row.active_states),
    nextStates: normalizeStateList(row.next_states),
    status: row.status,
    ...(row.description ? { description: row.description } : {}),
  }));
}

async function listAgentDefinitionsForSettings(
  client: DatabaseClient,
): Promise<AgentDefinitionSettingsRecord[]> {
  const result = await client.query<AgentDefinitionSettingsRow>(
    `
      select
        agent_definitions.id,
        agent_definitions.role_id,
        roles.key as role_key,
        agent_definitions.name,
        agent_definitions.runtime,
        agent_definitions.model,
        agent_definitions.reasoning_effort,
        agent_definitions.tool_profile,
        agent_definitions.max_turns,
        agent_definitions.timeout_seconds,
        agent_definitions.status
      from agent_definitions
      join roles on roles.id = agent_definitions.role_id
      order by roles.key asc, agent_definitions.name asc
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    roleId: row.role_id,
    roleKey: row.role_key,
    name: row.name,
    runtime: row.runtime,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    toolProfile: row.tool_profile,
    maxTurns: row.max_turns,
    timeoutSeconds: row.timeout_seconds,
    status: row.status,
  }));
}

async function scopeExists(
  client: DatabaseClient,
  scope: PromptBindingScope,
  scopeId: string,
): Promise<boolean> {
  const table = tableForScope(scope);
  const result = await client.query<{ exists: boolean }>(
    `select exists(select 1 from ${table} where id = $1)`,
    [scopeId],
  );

  return result.rows[0]?.exists ?? false;
}

async function promptComponentExists(
  client: DatabaseClient,
  promptComponentId: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "select exists(select 1 from prompt_components where id = $1)",
    [promptComponentId],
  );

  return result.rows[0]?.exists ?? false;
}

function tableForScope(scope: PromptBindingScope): string {
  const tables: Record<PromptBindingScope, string> = {
    team: "teams",
    project: "projects",
    repo: "repositories",
    role: "roles",
    agent: "agent_definitions",
  };
  return tables[scope];
}

function mapPromptBindingRow(row: PromptBindingRow): PromptBindingRecord {
  return {
    id: row.id,
    scope: row.scope_type,
    scopeId: row.scope_id,
    scopeName: row.scope_name,
    promptComponentId: row.prompt_component_id,
    promptComponentName: row.prompt_component_name,
    promptComponentVersion: row.prompt_component_version,
    promptComponentStatus: row.prompt_component_status,
    orderIndex: row.order_index,
    environment: row.environment,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeStateList(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value
    .split(",")
    .map((state) => state.trim())
    .filter(Boolean);
}

async function insertPromptBindingAuditEvent(
  client: DatabaseClient,
  input: {
    bindingId: string;
    action: string;
    message: string;
    status: PromptBindingStatus;
    actor?: SettingsAuditActor;
  },
): Promise<void> {
  await client.query(
    `
      insert into audit_events (
        id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        message,
        payload,
        created_at
      )
      values (
        gen_random_uuid(),
        $1,
        $2,
        'prompt_binding',
        $3,
        $4,
        jsonb_build_object(
          'status', $5::text,
          'actor', jsonb_build_object(
            'name', $6::text,
            'roles', to_jsonb($7::text[])
          )
        ),
        now()
      )
    `,
    [
      input.actor?.userId ?? null,
      input.action,
      input.bindingId,
      input.message,
      input.status,
      input.actor?.name ?? "unknown",
      input.actor?.roles ?? [],
    ],
  );
}

function actionForPromptBindingStatus(status: PromptBindingStatus): string {
  if (status === "active") {
    return "prompt_binding.approve";
  }

  if (status === "rejected") {
    return "prompt_binding.reject";
  }

  if (status === "disabled") {
    return "prompt_binding.disable";
  }

  return "prompt_binding.request";
}
