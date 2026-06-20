import {
  archiveAgentDefinitionSettings,
  archiveRepositorySettings,
  archiveRoleSettings,
  createAgentDefinitionSettings,
  createPromptBinding,
  createRepositorySettings,
  createRoleSettings,
  getDispatchPolicy,
  getMonitoringThresholds,
  getProjectSettingsSnapshot,
  listAuditEvents,
  listPromptBindings,
  listPromptComponents,
  updateAgentDefinitionSettings,
  updateDispatchPolicy,
  updateMonitoringThresholds,
  updatePromptBindingStatus,
  updateRepositorySettings,
  updateRoleSettings,
  withDatabasePool,
  withTransaction,
  type AuditEventFilters,
  type CreatePromptBindingInput,
  type CreateAgentDefinitionSettingsInput,
  type CreateRepositorySettingsInput,
  type CreateRoleSettingsInput,
  type DispatchPolicy,
  type MonitoringThresholds,
  type PromptBindingScope,
  type PromptBindingStatus,
  type UpdateAgentDefinitionSettingsInput,
  type UpdateRepositorySettingsInput,
  type UpdateRoleSettingsInput,
} from "@agent-control-plane/db";
import {
  canApprovePromptBinding,
  canManageMonitoringSettings,
  canManageProjectSettings,
  canRequestPromptBinding,
  getOperatorContext,
  monitoringSettingsPermissionMessage,
  promptBindingPermissionMessage,
  projectSettingsPermissionMessage,
} from "../../src/operator";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const bindingScopes = ["team", "project", "repo", "role", "agent"] as const;

interface SettingsPageProps {
  searchParams?: Promise<{
    auditEntityType?: string;
    auditAction?: string;
    auditActor?: string;
    auditLimit?: string;
  }>;
}

export default async function SettingsPage(props: SettingsPageProps) {
  const searchParams = await props.searchParams;
  const auditFilters = parseAuditFilters(searchParams);
  const operator = getOperatorContext();
  const canRequestBinding = canRequestPromptBinding(operator);
  const canApproveBinding = canApprovePromptBinding(operator);
  const canManageMonitoring = canManageMonitoringSettings(operator);
  const canManageProject = canManageProjectSettings(operator);
  const snapshot = await withDatabasePool(async (pool) => {
    const [
      settings,
      promptBindings,
      promptComponents,
      promptBindingAudits,
      monitoringThresholds,
      dispatchPolicy,
    ] = await Promise.all([
      getProjectSettingsSnapshot(pool),
      listPromptBindings(pool),
      listPromptComponents(pool, { status: "active", limit: 200 }),
      listAuditEvents(pool, auditFilters),
      getMonitoringThresholds(pool),
      getDispatchPolicy(pool),
    ]);

    return {
      ...settings,
      promptBindings,
      promptComponents,
      promptBindingAudits,
      monitoringThresholds,
      dispatchPolicy,
    };
  });

  async function createBindingAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canRequestPromptBinding(operator)) {
      throw new Error(promptBindingPermissionMessage("request"));
    }

    const input = parseCreateBindingForm(formData);
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => createPromptBinding(client, { ...input, actor: operator })),
    );
    if (!result.updated) {
      throw new Error(`Create binding failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function bindingStatusAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canApprovePromptBinding(operator)) {
      throw new Error(promptBindingPermissionMessage("approve"));
    }

    const bindingId = String(formData.get("bindingId") ?? "").trim();
    const status = parseBindingStatus(String(formData.get("status") ?? ""));
    if (!bindingId || !status) {
      throw new Error("bindingId and status are required");
    }

    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) =>
        updatePromptBindingStatus(client, bindingId, status, operator),
      ),
    );
    if (!result.updated) {
      throw new Error(`Update binding failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function repositorySettingsAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const input = parseRepositorySettingsForm(formData);
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => updateRepositorySettings(client, input)),
    );
    if (!result.updated) {
      throw new Error(`Update repository failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function createRepositoryAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const input = parseCreateRepositoryForm(formData);
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => createRepositorySettings(client, input)),
    );
    if (!result.updated) {
      throw new Error(`Create repository failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function archiveRepositoryAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const repositoryId = requiredString(formData, "repositoryId");
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => archiveRepositorySettings(client, repositoryId)),
    );
    if (!result.updated) {
      throw new Error(`Archive repository failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function roleSettingsAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const input = parseRoleSettingsForm(formData);
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => updateRoleSettings(client, input)),
    );
    if (!result.updated) {
      throw new Error(`Update role failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function createRoleAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const input = parseCreateRoleForm(formData);
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => createRoleSettings(client, input)),
    );
    if (!result.updated) {
      throw new Error(`Create role failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function archiveRoleAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const roleId = requiredString(formData, "roleId");
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => archiveRoleSettings(client, roleId)),
    );
    if (!result.updated) {
      throw new Error(`Archive role failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function agentDefinitionSettingsAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const input = parseAgentDefinitionSettingsForm(formData);
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => updateAgentDefinitionSettings(client, input)),
    );
    if (!result.updated) {
      throw new Error(`Update agent definition failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function createAgentDefinitionAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const input = parseCreateAgentDefinitionForm(formData);
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => createAgentDefinitionSettings(client, input)),
    );
    if (!result.updated) {
      throw new Error(`Create agent definition failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function archiveAgentDefinitionAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const agentDefinitionId = requiredString(formData, "agentDefinitionId");
    const result = await withDatabasePool((pool) =>
      withTransaction(pool, (client) => archiveAgentDefinitionSettings(client, agentDefinitionId)),
    );
    if (!result.updated) {
      throw new Error(`Archive agent definition failed: ${result.reason ?? "unknown"}`);
    }

    redirect("/settings");
  }

  async function monitoringThresholdsAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageMonitoringSettings(operator)) {
      throw new Error(monitoringSettingsPermissionMessage());
    }

    const input = parseMonitoringThresholdsForm(formData);
    await withDatabasePool((pool) =>
      withTransaction(pool, (client) =>
        updateMonitoringThresholds(client, { ...input, actorName: operator.name }),
      ),
    );

    redirect("/settings");
  }

  async function dispatchPolicyAction(formData: FormData) {
    "use server";
    const operator = getOperatorContext();
    if (!canManageProjectSettings(operator)) {
      throw new Error(projectSettingsPermissionMessage());
    }

    const input = parseDispatchPolicyForm(formData);
    await withDatabasePool((pool) =>
      withTransaction(pool, (client) =>
        updateDispatchPolicy(client, { ...input, actorName: operator.name }),
      ),
    );

    redirect("/settings");
  }

  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <div>
            <Link className="back-link" href="/">
              ← 控制台
            </Link>
            <h1>Project Settings</h1>
            <p className="subtle">管理项目、仓库、角色、agent definition 和 prompt binding。</p>
            <p className="subtle">
              当前 operator：{operator.name} · roles{" "}
              {operator.roles.length > 0 ? operator.roles.join(", ") : "none"}
            </p>
            <p className="subtle">
              <Link href="/session">查看当前 session</Link>
            </p>
          </div>
          <span className="badge">{snapshot.projects.length} projects</span>
        </header>

        <section className="grid">
          <article className="panel">
            <h2>Teams</h2>
            <div className="list">
              {snapshot.teams.map((team) => (
                <div className="row" key={team.id}>
                  <div>
                    <h3>{team.name}</h3>
                    <p className="subtle">{team.description ?? team.key}</p>
                  </div>
                  <span className="badge">{team.key}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <h2>Projects</h2>
            <div className="list">
              {snapshot.projects.map((project) => (
                <div className="row" key={project.id}>
                  <div>
                    <h3>{project.slug}</h3>
                    <p className="subtle">{project.description ?? project.name}</p>
                  </div>
                  <span className={`badge ${project.status === "active" ? "ready" : "warn"}`}>
                    {project.status}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel full">
            <h2>Monitoring Thresholds</h2>
            <p className="subtle">
              修改后写入数据库，首页运行监控下次刷新立即生效，不需要重启 Web/Worker。
            </p>
            {!canManageMonitoring ? (
              <p className="subtle">{monitoringSettingsPermissionMessage()}</p>
            ) : null}
            <form action={monitoringThresholdsAction} className="threshold-settings-form">
              <label>
                <span>Queue Warning</span>
                <input
                  name="queueBacklogWarning"
                  type="number"
                  min="0"
                  defaultValue={snapshot.monitoringThresholds.queueBacklogWarning}
                />
              </label>
              <label>
                <span>Stalled Critical</span>
                <input
                  name="stalledRunsCritical"
                  type="number"
                  min="0"
                  defaultValue={snapshot.monitoringThresholds.stalledRunsCritical}
                />
              </label>
              <label>
                <span>Retry Backlog</span>
                <input
                  name="retryBacklogWarning"
                  type="number"
                  min="0"
                  defaultValue={snapshot.monitoringThresholds.retryBacklogWarning}
                />
              </label>
              <label>
                <span>Failure Critical</span>
                <input
                  name="failureRateCritical"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  defaultValue={snapshot.monitoringThresholds.failureRateCritical}
                />
              </label>
              <label>
                <span>Min Finished</span>
                <input
                  name="failureRateMinFinished"
                  type="number"
                  min="0"
                  defaultValue={snapshot.monitoringThresholds.failureRateMinFinished}
                />
              </label>
              <label>
                <span>Cost Warning USD</span>
                <input
                  name="costWarningUsd"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={snapshot.monitoringThresholds.costWarningUsd}
                />
              </label>
              <label>
                <span>Retry Backoff MS</span>
                <input
                  name="retryBackoffMs"
                  type="number"
                  min="0"
                  defaultValue={snapshot.monitoringThresholds.retryBackoffMs}
                />
              </label>
              <button disabled={!canManageMonitoring} type="submit">
                保存监控阈值
              </button>
            </form>
          </article>

          <article className="panel full">
            <h2>派发策略</h2>
            <p className="subtle">
              写入数据库后，Worker 下一轮派发会优先生效；留空表示不限制单 run 估算成本。
            </p>
            {!canManageProject ? (
              <p className="subtle">{projectSettingsPermissionMessage()}</p>
            ) : null}
            <form action={dispatchPolicyAction} className="threshold-settings-form">
              <label>
                <span>单次运行成本上限 USD</span>
                <input
                  name="maxEstimatedCostUsdPerRun"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="unlimited"
                  defaultValue={snapshot.dispatchPolicy.maxEstimatedCostUsdPerRun ?? ""}
                />
              </label>
              <label>
                <span>Queue Priority</span>
                <select
                  name="queuePriorityPolicy"
                  defaultValue={snapshot.dispatchPolicy.queuePriorityPolicy}
                >
                  <option value="priority_first">优先级优先</option>
                  <option value="priority_aging">优先级 + 等待老化</option>
                  <option value="repo_fair">跨仓库公平轮转</option>
                  <option value="weighted_priority">优先级 + 成本权重</option>
                  <option value="oldest_first">最早更新优先</option>
                  <option value="newest_first">最近更新优先</option>
                </select>
              </label>
              <button disabled={!canManageProject} type="submit">
                保存派发策略
              </button>
            </form>
          </article>

          <article className="panel wide">
            <h2>Repositories</h2>
            {!canManageProject ? (
              <p className="form-error">{projectSettingsPermissionMessage()}</p>
            ) : null}
            <div className="table-list">
              {snapshot.repositories.map((repo) => (
                <form action={repositorySettingsAction} className="settings-row" key={repo.id}>
                  <input name="repositoryId" type="hidden" value={repo.id} />
                  <div>
                    <label>
                      <span>Slug</span>
                      <input name="slug" defaultValue={repo.slug} />
                    </label>
                    <p className="subtle">{repo.projectSlug}</p>
                  </div>
                  <div>
                    <label>
                      <span>Git URL</span>
                      <input name="gitUrl" defaultValue={repo.gitUrl} />
                    </label>
                  </div>
                  <div>
                    <label>
                      <span>Branch</span>
                      <input name="defaultBranch" defaultValue={repo.defaultBranch} />
                    </label>
                    <label>
                      <span>Status</span>
                      <input name="status" defaultValue={repo.status} />
                    </label>
                  </div>
                  <div>
                    <label>
                      <span>Local Path</span>
                      <input name="localPath" defaultValue={repo.localPath ?? ""} />
                    </label>
                    <label>
                      <span>Description</span>
                      <input name="description" defaultValue={repo.description ?? ""} />
                    </label>
                  </div>
                  <div className="button-stack">
                    <button disabled={!canManageProject} type="submit">
                      保存 Repo
                    </button>
                    <button
                      disabled={!canManageProject}
                      formAction={archiveRepositoryAction}
                      type="submit"
                    >
                      归档 Repo
                    </button>
                  </div>
                </form>
              ))}
            </div>
            <form action={createRepositoryAction} className="create-settings-form">
              <h3>新增 Repository</h3>
              <select name="projectId" defaultValue={snapshot.projects[0]?.id ?? ""}>
                {snapshot.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.slug}
                  </option>
                ))}
              </select>
              <input name="slug" placeholder="repo slug" />
              <input name="gitUrl" placeholder="git URL" />
              <input name="defaultBranch" defaultValue="main" />
              <input name="localPath" placeholder="local path" />
              <input name="status" defaultValue="active" />
              <input name="description" placeholder="description" />
              <button disabled={!canManageProject} type="submit">
                新增 Repo
              </button>
            </form>
          </article>

          <article className="panel wide">
            <h2>Roles</h2>
            {!canManageProject ? (
              <p className="form-error">{projectSettingsPermissionMessage()}</p>
            ) : null}
            <div className="table-list">
              {snapshot.roles.map((role) => (
                <form action={roleSettingsAction} className="settings-row" key={role.id}>
                  <input name="roleId" type="hidden" value={role.id} />
                  <div>
                    <label>
                      <span>Name</span>
                      <input name="name" defaultValue={role.name} />
                    </label>
                    <p className="subtle">{role.key}</p>
                  </div>
                  <label>
                    <span>Active States</span>
                    <input name="activeStates" defaultValue={role.activeStates.join(", ")} />
                  </label>
                  <label>
                    <span>Next States</span>
                    <input name="nextStates" defaultValue={role.nextStates.join(", ")} />
                  </label>
                  <label>
                    <span>Description</span>
                    <input name="description" defaultValue={role.description ?? ""} />
                  </label>
                  <label>
                    <span>Status</span>
                    <input name="status" defaultValue={role.status} />
                  </label>
                  <div className="button-stack">
                    <button disabled={!canManageProject} type="submit">
                      保存 Role
                    </button>
                    <button
                      disabled={!canManageProject}
                      formAction={archiveRoleAction}
                      type="submit"
                    >
                      归档 Role
                    </button>
                  </div>
                </form>
              ))}
            </div>
            <form action={createRoleAction} className="create-settings-form">
              <h3>新增 Role</h3>
              <input name="key" placeholder="role key" />
              <input name="name" placeholder="role name" />
              <input name="activeStates" placeholder="Development" />
              <input name="nextStates" placeholder="Code Review, Blocked, Done, Canceled" />
              <input name="status" defaultValue="active" />
              <input name="description" placeholder="description" />
              <button disabled={!canManageProject} type="submit">
                新增 Role
              </button>
            </form>
          </article>

          <article className="panel wide">
            <h2>Agent Definitions</h2>
            {!canManageProject ? (
              <p className="form-error">{projectSettingsPermissionMessage()}</p>
            ) : null}
            <div className="table-list">
              {snapshot.agentDefinitions.map((agent) => (
                <form
                  action={agentDefinitionSettingsAction}
                  className="settings-row"
                  key={agent.id}
                >
                  <input name="agentDefinitionId" type="hidden" value={agent.id} />
                  <div>
                    <label>
                      <span>Name</span>
                      <input name="name" defaultValue={agent.name} />
                    </label>
                    <p className="subtle">{agent.roleKey}</p>
                  </div>
                  <div>
                    <label>
                      <span>Runtime</span>
                      <input name="runtime" defaultValue={agent.runtime} />
                    </label>
                    <label>
                      <span>Model</span>
                      <input name="model" defaultValue={agent.model} />
                    </label>
                  </div>
                  <div>
                    <label>
                      <span>Reasoning</span>
                      <input name="reasoningEffort" defaultValue={agent.reasoningEffort} />
                    </label>
                    <label>
                      <span>Tool Profile</span>
                      <input name="toolProfile" defaultValue={agent.toolProfile} />
                    </label>
                  </div>
                  <div>
                    <label>
                      <span>Max Turns</span>
                      <input name="maxTurns" type="number" defaultValue={agent.maxTurns} />
                    </label>
                    <label>
                      <span>Timeout</span>
                      <input
                        name="timeoutSeconds"
                        type="number"
                        defaultValue={agent.timeoutSeconds}
                      />
                    </label>
                    <label>
                      <span>Status</span>
                      <input name="status" defaultValue={agent.status} />
                    </label>
                  </div>
                  <div className="button-stack">
                    <button disabled={!canManageProject} type="submit">
                      保存 Agent
                    </button>
                    <button
                      disabled={!canManageProject}
                      formAction={archiveAgentDefinitionAction}
                      type="submit"
                    >
                      归档 Agent
                    </button>
                  </div>
                </form>
              ))}
            </div>
            <form action={createAgentDefinitionAction} className="create-settings-form">
              <h3>新增 Agent Definition</h3>
              <select name="roleId" defaultValue={snapshot.roles[0]?.id ?? ""}>
                {snapshot.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.key}
                  </option>
                ))}
              </select>
              <input name="name" placeholder="agent name" />
              <input name="runtime" defaultValue="openhands" />
              <input name="model" defaultValue="gpt-5.5" />
              <input name="reasoningEffort" defaultValue="high" />
              <input name="toolProfile" defaultValue="default" />
              <input name="maxTurns" type="number" defaultValue="80" />
              <input name="timeoutSeconds" type="number" defaultValue="7200" />
              <input name="status" defaultValue="active" />
              <button disabled={!canManageProject} type="submit">
                新增 Agent
              </button>
            </form>
          </article>

          <article className="panel full">
            <h2>Prompt Bindings</h2>
            <div className="table-list">
              {snapshot.promptBindings.map((binding) => (
                <div className="task-row" key={binding.id}>
                  <div>
                    <h2>
                      {binding.scope} · {binding.scopeName}
                    </h2>
                    <p className="subtle">
                      {binding.promptComponentName} v{binding.promptComponentVersion} · order{" "}
                      {binding.orderIndex}
                    </p>
                  </div>
                  <div className="task-meta">
                    <span className="badge">{binding.environment}</span>
                    <span className={`badge ${binding.status === "active" ? "ready" : "warn"}`}>
                      {binding.status}
                    </span>
                    <span
                      className={`badge ${
                        binding.promptComponentStatus === "active" ? "ready" : "warn"
                      }`}
                    >
                      component {binding.promptComponentStatus}
                    </span>
                  </div>
                  <form action={bindingStatusAction} className="inline-form">
                    <input name="bindingId" type="hidden" value={binding.id} />
                    {canApproveBinding ? (
                      bindingStatusActions(binding.status).map((action) => (
                        <button
                          key={action.status}
                          name="status"
                          type="submit"
                          value={action.status}
                        >
                          {action.label}
                        </button>
                      ))
                    ) : (
                      <span className="subtle">需要 prompt_admin 审批权限</span>
                    )}
                  </form>
                  <Link
                    className="detail-link"
                    href={`/prompt-components/${binding.promptComponentId}`}
                  >
                    查看 Prompt
                  </Link>
                </div>
              ))}
            </div>
          </article>

          <article className="panel wide">
            <h2>新增 Binding</h2>
            {!canRequestBinding ? (
              <p className="subtle">{promptBindingPermissionMessage("request")}</p>
            ) : null}
            <form action={createBindingAction} className="action-form">
              <select name="scope" defaultValue="team">
                {bindingScopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </select>
              <select name="scopeId" defaultValue={snapshot.teams[0]?.id ?? ""}>
                <optgroup label="team">
                  {snapshot.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      team · {team.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="project">
                  {snapshot.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      project · {project.slug}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="repo">
                  {snapshot.repositories.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      repo · {repo.slug}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="role">
                  {snapshot.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      role · {role.key}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="agent">
                  {snapshot.agentDefinitions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      agent · {agent.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <select
                name="promptComponentId"
                defaultValue={snapshot.promptComponents[0]?.id ?? ""}
              >
                {snapshot.promptComponents.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.scope} · {component.name} v{component.version}
                  </option>
                ))}
              </select>
              <input name="orderIndex" type="number" defaultValue="10" />
              <input name="environment" defaultValue="dev" />
              <button disabled={!canRequestBinding} type="submit">
                提交 Binding 审批
              </button>
            </form>
          </article>

          <article className="panel wide">
            <h2>审计事件</h2>
            <form className="filters" action="/settings">
              <label>
                <span>Entity Type</span>
                <input
                  name="auditEntityType"
                  placeholder="prompt_binding"
                  defaultValue={auditFilters.entityType ?? ""}
                />
              </label>
              <label>
                <span>Action</span>
                <input
                  name="auditAction"
                  placeholder="prompt_binding.approve"
                  defaultValue={auditFilters.action ?? ""}
                />
              </label>
              <label>
                <span>Actor</span>
                <input
                  name="auditActor"
                  placeholder="operator"
                  defaultValue={auditFilters.actor ?? ""}
                />
              </label>
              <label>
                <span>Limit</span>
                <input
                  name="auditLimit"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={String(auditFilters.limit ?? 20)}
                />
              </label>
              <button type="submit">筛选审计</button>
            </form>
            <div className="list">
              {snapshot.promptBindingAudits.map((event) => (
                <div className="row" key={event.id}>
                  <div>
                    <h3>{event.action}</h3>
                    <p className="subtle">
                      {event.entityType} · {event.entityId} · {event.message} ·{" "}
                      {event.actorName ?? "unknown"} · {event.createdAt.toISOString()}
                    </p>
                  </div>
                  <span className="badge">{event.status ?? "n/a"}</span>
                </div>
              ))}
              {snapshot.promptBindingAudits.length === 0 ? (
                <p className="subtle">暂无审计事件。</p>
              ) : null}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

function parseAuditFilters(
  searchParams: Awaited<SettingsPageProps["searchParams"]>,
): AuditEventFilters {
  const limit = Number.parseInt(searchParams?.auditLimit ?? "", 10);

  return {
    ...(searchParams?.auditEntityType?.trim()
      ? { entityType: searchParams.auditEntityType.trim() }
      : {}),
    ...(searchParams?.auditAction?.trim() ? { action: searchParams.auditAction.trim() } : {}),
    ...(searchParams?.auditActor?.trim() ? { actor: searchParams.auditActor.trim() } : {}),
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
  };
}

function parseCreateBindingForm(formData: FormData): CreatePromptBindingInput {
  const scope = parseBindingScope(String(formData.get("scope") ?? ""));
  const scopeId = String(formData.get("scopeId") ?? "").trim();
  const promptComponentId = String(formData.get("promptComponentId") ?? "").trim();
  const orderIndex = Number.parseInt(String(formData.get("orderIndex") ?? ""), 10);
  const environment = String(formData.get("environment") ?? "").trim();

  if (!scope || !scopeId || !promptComponentId || !Number.isFinite(orderIndex)) {
    throw new Error("scope, scopeId, promptComponentId and orderIndex are required");
  }

  return {
    scope,
    scopeId,
    promptComponentId,
    orderIndex,
    ...(environment ? { environment } : {}),
  };
}

function parseRepositorySettingsForm(formData: FormData): UpdateRepositorySettingsInput {
  const repositoryId = requiredString(formData, "repositoryId");
  const slug = requiredString(formData, "slug");
  const gitUrl = requiredString(formData, "gitUrl");
  const defaultBranch = requiredString(formData, "defaultBranch");
  const status = requiredString(formData, "status");
  const localPath = optionalString(formData, "localPath");
  const description = optionalString(formData, "description");

  return {
    repositoryId,
    slug,
    gitUrl,
    defaultBranch,
    status,
    ...(localPath ? { localPath } : {}),
    ...(description ? { description } : {}),
  };
}

function parseCreateRepositoryForm(formData: FormData): CreateRepositorySettingsInput {
  const localPath = optionalString(formData, "localPath");
  const description = optionalString(formData, "description");
  const status = optionalString(formData, "status");

  return {
    projectId: requiredString(formData, "projectId"),
    slug: requiredString(formData, "slug"),
    gitUrl: requiredString(formData, "gitUrl"),
    defaultBranch: requiredString(formData, "defaultBranch"),
    ...(localPath ? { localPath } : {}),
    ...(status ? { status } : {}),
    ...(description ? { description } : {}),
  };
}

function parseRoleSettingsForm(formData: FormData): UpdateRoleSettingsInput {
  const roleId = requiredString(formData, "roleId");
  const name = requiredString(formData, "name");
  const activeStates = parseCsv(requiredString(formData, "activeStates"));
  const nextStates = parseCsv(requiredString(formData, "nextStates"));
  const status = requiredString(formData, "status");
  const description = optionalString(formData, "description");

  return {
    roleId,
    name,
    activeStates,
    nextStates,
    status,
    ...(description ? { description } : {}),
  };
}

function parseCreateRoleForm(formData: FormData): CreateRoleSettingsInput {
  const description = optionalString(formData, "description");
  const status = optionalString(formData, "status");

  return {
    key: requiredString(formData, "key"),
    name: requiredString(formData, "name"),
    activeStates: parseCsv(requiredString(formData, "activeStates")),
    nextStates: parseCsv(requiredString(formData, "nextStates")),
    ...(status ? { status } : {}),
    ...(description ? { description } : {}),
  };
}

function parseAgentDefinitionSettingsForm(formData: FormData): UpdateAgentDefinitionSettingsInput {
  return {
    agentDefinitionId: requiredString(formData, "agentDefinitionId"),
    name: requiredString(formData, "name"),
    runtime: requiredString(formData, "runtime"),
    model: requiredString(formData, "model"),
    reasoningEffort: requiredString(formData, "reasoningEffort"),
    toolProfile: requiredString(formData, "toolProfile"),
    maxTurns: requiredNumber(formData, "maxTurns"),
    timeoutSeconds: requiredNumber(formData, "timeoutSeconds"),
    status: requiredString(formData, "status"),
  };
}

function parseCreateAgentDefinitionForm(formData: FormData): CreateAgentDefinitionSettingsInput {
  const status = optionalString(formData, "status");

  return {
    roleId: requiredString(formData, "roleId"),
    name: requiredString(formData, "name"),
    runtime: requiredString(formData, "runtime"),
    model: requiredString(formData, "model"),
    reasoningEffort: requiredString(formData, "reasoningEffort"),
    toolProfile: requiredString(formData, "toolProfile"),
    maxTurns: requiredNumber(formData, "maxTurns"),
    timeoutSeconds: requiredNumber(formData, "timeoutSeconds"),
    ...(status ? { status } : {}),
  };
}

function parseMonitoringThresholdsForm(formData: FormData): MonitoringThresholds {
  return {
    queueBacklogWarning: requiredNonNegativeInteger(formData, "queueBacklogWarning"),
    stalledRunsCritical: requiredNonNegativeInteger(formData, "stalledRunsCritical"),
    retryBacklogWarning: requiredNonNegativeInteger(formData, "retryBacklogWarning"),
    failureRateCritical: requiredRatio(formData, "failureRateCritical"),
    failureRateMinFinished: requiredNonNegativeInteger(formData, "failureRateMinFinished"),
    costWarningUsd: requiredNonNegativeNumber(formData, "costWarningUsd"),
    retryBackoffMs: requiredNonNegativeInteger(formData, "retryBackoffMs"),
  };
}

function parseDispatchPolicyForm(formData: FormData): DispatchPolicy {
  const rawValue = optionalString(formData, "maxEstimatedCostUsdPerRun");
  const queuePriorityPolicy = parseQueuePriorityPolicy(
    String(formData.get("queuePriorityPolicy") ?? ""),
  );

  if (!rawValue) {
    return { queuePriorityPolicy };
  }

  const maxEstimatedCostUsdPerRun = Number.parseFloat(rawValue);
  if (!Number.isFinite(maxEstimatedCostUsdPerRun) || maxEstimatedCostUsdPerRun < 0) {
    throw new Error("maxEstimatedCostUsdPerRun must be a non-negative number");
  }

  return { maxEstimatedCostUsdPerRun, queuePriorityPolicy };
}

function parseQueuePriorityPolicy(value: string): DispatchPolicy["queuePriorityPolicy"] {
  if (
    value === "priority_aging" ||
    value === "repo_fair" ||
    value === "weighted_priority" ||
    value === "oldest_first" ||
    value === "newest_first"
  ) {
    return value;
  }

  return "priority_first";
}

function parseBindingScope(value: string): PromptBindingScope | undefined {
  return bindingScopes.includes(value as PromptBindingScope)
    ? (value as PromptBindingScope)
    : undefined;
}

function parseBindingStatus(value: string): PromptBindingStatus | undefined {
  if (value === "pending" || value === "active" || value === "disabled" || value === "rejected") {
    return value;
  }

  return undefined;
}

function bindingStatusActions(
  status: PromptBindingStatus,
): Array<{ status: PromptBindingStatus; label: string }> {
  if (status === "pending") {
    return [
      { status: "active", label: "批准" },
      { status: "rejected", label: "拒绝" },
    ];
  }

  if (status === "active") {
    return [{ status: "disabled", label: "禁用" }];
  }

  return [{ status: "pending", label: "重新提交" }];
}

function requiredString(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function optionalString(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function requiredNumber(formData: FormData, key: string): number {
  const value = Number.parseInt(String(formData.get(key) ?? ""), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }

  return value;
}

function requiredNonNegativeInteger(formData: FormData, key: string): number {
  const value = Number.parseInt(String(formData.get(key) ?? ""), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }

  return Math.trunc(value);
}

function requiredNonNegativeNumber(formData: FormData, key: string): number {
  const value = Number.parseFloat(String(formData.get(key) ?? ""));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number`);
  }

  return value;
}

function requiredRatio(formData: FormData, key: string): number {
  const value = Number.parseFloat(String(formData.get(key) ?? ""));
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${key} must be between 0 and 1`);
  }

  return value;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
