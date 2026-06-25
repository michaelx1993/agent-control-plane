# Plane User-Level Agent Management Design

Status: PRD
Last updated: 2026-06-25

## 背景

当前 Agent Control Plane 已经把 Symphony 的执行经验吸收到默认架构中：

- Plane 承载项目、任务、状态、人工 review，以及 Agent / Prompt / Project Workspace 的可编辑配置。
- Agent Control Plane 承载 Plane 配置的 runtime projection、prompt release、状态机、repo routing、run、审计和 worker 调度。
- Worker 在目标 workspace 中启动 Codex CLI / `codex app-server` 执行任务。

新的产品判断是：Agent 和 Prompt 都应该是用户可管理的一等资源。用户维护自己的常用 Agent、常用 Prompt、常用配置和常用 workflow；Project 只绑定和启用这些 User Agent / Prompt，并补充项目上下文、repo、Agent Box、Playbook 和默认 Team。

角色 Agent 的管理入口需要迁移到 Plane 平台上。Plane 需要同时提供用户级 `Agent Library` 和项目级 `Agents` 页面，而不是把 Role、Team、Playbook 和 Agent Box 留在独立 Control Plane 设置页或 Markdown 文件里。

这个迁移不意味着把执行逻辑塞进 Plane。Plane 是管理面和用户入口；Agent Control Plane 与 agent runtime 仍是执行控制面。

## 目标

- 在 Plane 用户设置中提供 User Agent Library 和 Prompt Library。
- 在 Plane 项目内提供 Project Workspace、Repository Registry、Project Agent Bindings、项目默认 Team/Playbook 和 Agent Box 管理入口。
- 让用户、项目、任务、repo、User Agent、Agent Box、Role、Team、Playbook 和 Run 形成统一体验。
- 让布置任务时可以显式指定每个 Playbook node 由哪个 User Agent 执行。
- 第一阶段要求任务必须绑定已注册 repository；repo-less task 留到后续阶段。
- 让常用 Prompt、Agent 配置和 workflow 模板可版本化、可复用、可审计。
- 保持底层 agent runtime 独立，避免 Plane 与执行器强耦合。
- 继承 Symphony 已验证的 prompt composition、状态路由、Workpad/handoff 和 Codex app-server 执行链路。

## 非目标

- 不让 Plane 直接启动 Codex、管理 worker lease 或访问 worker secrets。
- 不让 Plane 直连 Agent Control Plane 数据库。
- 不把 Prompt 散落到 Plane issue 描述、comment 或前端本地状态中。
- 第一版不实现多个物理 agent 进程的复杂协同；可以先用单一 Codex session 按 role/state 切换 prompt。
- 第一版不支持无 repository 的通用任务；后续可支持纯文档、调研、运营类 repo-less task。
- 第一版不依赖 OpenHands Cloud、Langfuse Cloud 或其它付费 SaaS 作为必需路径。

## 核心决策

### 1. Agent 是 User 级资源

Agent 属于用户，不属于项目。一个用户可以创建多个可复用 Agent，例如：

- `我的 Codex 工程师`
- `我的 Code Reviewer`
- `我的 Release Manager`
- `我的安全审计 Agent`

Project 只保存 Agent binding：

- 当前 project 允许使用哪些 User Agent。
- 哪个 User Agent 是 project default agent，用于填充未显式分配的 node。
- 哪个 User Agent 是默认 Builder / Reviewer / Deployer。
- 布置任务时可显式覆盖默认值，指定本次 run 中每个 node 使用哪个 User Agent。
- 该 project 对 User Agent 的权限、模型、Playbook 是否有 override。

这样同一个 Agent 可以跨项目复用，而 project 不会复制出一堆私有 Agent。

### 2. Plane 是角色管理入口

Plane 用户设置页新增 `Agent Library`：

```text
User Settings
  Agent Library
    My Agents
    Prompt Library
    Team Templates
    Playbook Templates
```

Plane 项目页新增 `Agents` 区域：

```text
Project
  Agents
    Project Workspace
    Repositories
    Project Agent Bindings
    Agent Boxes
    Roles
    Teams
    Playbooks
    Runs
    Settings
```

用户在这里管理：

- 用户级 Agent Library。
- Project 绑定的 User Agent。
- 项目绑定的 Agent Box。
- 项目可用 Role。
- 常用 Agent Team。
- Playbook / workflow 模板。
- 最近 run、失败 run、等待人工确认的 run。

### 3. Prompt 是可绑定、可叠加的一等资源

Prompt 不只是 Agent 或 Role 上的一个文本字段。用户可以新建 Prompt，并声明它的属性：

- `scope`: agent / project / role / playbook / task / workspace
- `kind`: instruction / context / constraint / workflow / style / safety / output-contract
- `status`: draft / active / archived
- `visibility`: private / project / workspace
- `order`: 组合顺序
- `variables`: 渲染所需变量

Agent 初始化时可以绑定一个或多个 Prompt。Prompt 组合语义是 append/stack，不是覆盖。运行时按 scope 和 order 组合：

```text
agent prompts
+ project prompts
+ role prompts
+ playbook prompts
+ task prompts
+ workspace prompts
```

这里的 `workspace prompts` 指业务侧全局契约、合规边界和运行约束，不是模型 provider 的内置 system prompt。模型 runtime system prompt 仍由执行器内部控制，不作为普通用户可编辑资源暴露。

### 4. Plane 是可编辑配置源，Agent Control Plane 是运行快照源

User Agent、Prompt、Role、Team、Playbook、Project Workspace 和 Repository 的用户可编辑配置由 Plane 管理。Agent Control Plane 保存这些配置的 runtime projection，并在创建 run 时冻结不可变 snapshot。Plane 通过 API 或事件把 versioned projection 发布给 Control Plane，但不直接读写 Control Plane DB。

原因：

- 用户操作、编辑、版本发布和项目绑定需要出现在 Plane 的工作流里。
- 执行需要不可变 prompt snapshot 和审计记录。
- Worker claim 时需要拿到完整 agent/prompt/role/team/playbook 快照。
- 后续可能存在非 Plane 入口，例如 CLI、API、GitHub comment 或 webhook。
- 将来可以替换或重构执行内核，不影响 Plane 里的用户管理体验。

### 5. Runtime 是唯一执行契约

底层 runtime 负责：

- 根据 user agent、prompt bindings、project、task、role 和 playbook 组合 prompt。
- 根据 role permissions 和 project overrides 限制工具能力。
- 根据 playbook route 决定下一角色或下一状态。
- 启动 Codex session。
- 记录 role output、handoff notes、run events 和完成证据。

Plane 只展示这些对象，并触发 run。

### 6. 模板归 User，绑定归 Project

Agent、Prompt、Team Template 和 Playbook Template 默认都是用户级可复用模板。Project 只保存 binding 和 override：

- User 级：定义“我常用的 Agent、Prompt、团队编排和流程模板”。
- Project 级：定义“这个项目允许哪些 Agent、默认用哪个 Team/Playbook、权限如何收紧、绑定哪个 Agent Box”。

Project override 只能收紧权限、绑定项目级 Prompt 或替换项目上下文，不能绕过 User Agent、Prompt 或 Role 的基础权限契约。

### 7. 第一阶段任务必须绑定已注册 Repository

Agent 开发任务第一阶段必须选择一个已注册 repository。长期看 repository 不是所有任务的必需条件，但第一阶段为了让 Codex 能稳定进入代码上下文，必须先有 repo。

Repository 由 Plane project 管理入口注册，再同步到 Agent Control Plane：

- Plane 展示和管理项目仓库。
- Agent Control Plane 保存 repository mirror、clone 配置、默认分支和 credential reference。
- Worker 只从 Control Plane claim snapshot 读取 repository，不直接从 Plane 取配置。

后续 repo-less task 可以作为单独能力扩展，用于文档、调研、运营、项目规划等不依赖代码仓库的任务。

### 8. Prompt 与 Agent 保存后立即生效

Phase 1 不引入 draft / publish / approval 流程。Prompt 保存后立即生成新的 Prompt Version，并成为 latest；Agent 配置保存后立即影响后续新 run。历史 run 不受影响，因为 run 创建时会冻结当时解析出的 prompt versions 和 agent config snapshot。

Prompt Binding 决定绑定的版本策略：

- `latest`: 每次新 run 都解析到该 Prompt 的最新版本。
- `pinned`: 固定使用某个 Prompt Version。

用户不是在 Agent 里临时选择 Prompt 版本，而是在 Prompt Binding 上配置 `latest` 或 `pinned`。Phase 1 不提供用户可选的 Agent old version；Agent 只保留 audit/history，run snapshot 负责复现历史。

### 9. Prompt Preview 是必需能力

Plane 必须展示 assembled prompt preview，让用户知道本次 Agent 启动时能看到什么。Preview 至少出现在：

- Agent edit page: 查看 Agent 初始化 prompt stack。
- Run create page: 查看本次 run 的最终 assembled prompt。
- Run detail page: 查看 frozen assembled prompt snapshot。

Preview 必须展示每段 Prompt 的来源、scope、版本、顺序、变量渲染结果、最终拼装内容，以及本次 run 可用的 secret keys。Secret 值不作为默认 prompt preview 内容；Secret 是用户级密码本，Agent 使用时按 key 通过 runtime/tool 解析。

### 10. Secret 是 User 级密码本

Secret 是 User 级全局配置，类似用户密码本。Project、Repository、Agent 和 Run 只引用 secret key，不拥有 secret 值。

Run context 只提供 `available_secret_keys` 列表。Agent 需要使用 secret 时，通过 runtime/tool 按 key 请求；Worker 再从用户密码本解析实际值。这样用户能知道 Agent 有哪些钥匙，但不会把 secret value 预先散落进 prompt、run event 或项目文档。

### 11. Worker Card 是用户可见执行目标

Phase 1 的 Worker 部署在真实机器上，例如 Mac Studio / MBP，并复用宿主机已有 Codex、Git、Docker、SSH、登录态和工具环境。Plane 不在第一版做完整 tool registry 或 sandbox abstraction。

Project 可以配置默认 Worker Card；Run 创建时默认选中 Project default worker，用户可以覆盖。Run snapshot 必须冻结最终 worker id、worker host 摘要和 workspace policy。

### 12. Project Meta Git 是项目记忆底座

每个 Project Workspace 默认创建一个独立的本地 Project Meta Git repo，用于保存项目状态和过程记忆，不保存业务源码。Phase 1 默认本地保存；Phase 2 支持自动创建远程仓库并定时同步。

默认文件：

```text
status.md
progress.md
runs/<run_id>.md
playbooks/<playbook_id>.snapshot.md
artifacts/index.md
```

Plane 是唯一入口。用户不能绕过 Plane 直接编辑 Project Meta Git；Plane 的 Status / Progress / Artifacts UI 会渲染并提交这些文件。`status.md` 是当前状态快照，可以通过 Plane 表单编辑；`progress.md` 是 append-only 历史账本，只能追加 entry 或 correction。

Agent 可以读取 Project Meta Git 作为项目上下文。Run 启动时默认读取 `status.md`、最近 N 条 `progress.md`、相关 run summary 和 artifact index 摘要。

### 13. Plane 是全局计时板，SCM 是代码事实源

Plane 控制台展示任务和流水线状态；GitHub/GitLab 等 SCM Provider 承载代码变更事实。开发、review、merge、release 和 deployment 结果需要写回 Plane，同时代码相关结果也要写入 SCM Provider。

文案和模型不要写死 GitHub。UI 可统一使用 `Change Request` 表达 GitHub Pull Request 或 GitLab Merge Request。

## 目标架构

```text
Plane Web/API
  User Agent Library UI
  Prompt Library UI
  Project UI
  Project Agents UI
  Editable Agent / Prompt / Workspace config
  Issue "Run with Agent" action
        |
        | HTTPS REST
        v
Agent Control Plane Web/API
  Runtime config projection
  Prompt releases
  Run state machine
  Worker API
        |
        | claim / heartbeat / events / complete
        v
Distributed Worker
  Workspace manager
  Prompt renderer
  Tool permission enforcement
  Codex CLI / codex app-server adapter
```

## 产品模型

### User

User 是 Agent 的所有者。User 级 Agent 可以跨 project 复用。

User 级资源：

- User Agents
- Prompt Library
- User Secret Vault
- personal prompt overrides
- personal team templates
- personal playbook templates
- default model / reasoning preferences

### User Agent

User Agent 是用户维护的可复用 agent 人格和默认运行偏好。它回答“谁来做事”；Role 回答“这一步做什么事”。

字段建议：

```yaml
user_agent:
  id: user_agent_codex_engineer
  owner_user_id: user_123
  name: 我的 Codex 工程师
  description: 默认负责开发、测试、PR 和交付说明
  default_model: gpt-5-codex
  is_general_purpose: true
  default_role_id: builder
  prompt_bindings:
    - prompt_id: prompt_engineering_style
      version_id: prompt_engineering_style_v3
      scope: agent
      order: 10
    - prompt_id: prompt_delivery_contract
      version_id: prompt_delivery_contract_v2
      scope: agent
      order: 20
  default_tools:
    read_files: true
    write_files: true
    run_tests: true
    create_pr: true
    deploy: false
  status: active
```

User Agent 可以在不同 project 中绑定不同 role：

```text
Project: Plane 自研部署
  Builder  -> 我的 Codex 工程师
  Reviewer -> 我的 Code Reviewer
  Deployer -> 我的 Release Manager

Project: Agent Control Plane
  Builder  -> 我的 Codex 工程师
  Reviewer -> 我的 Code Reviewer
```

每个 project 必须可以配置一个通用 default agent。这个 agent 作为 node assignment 的兜底值，适合简单任务和未配置专门 Agent 的节点。

Phase 1 中 Agent 是 user-owned 但 workspace visible。Workspace 内用户可以查看、使用和绑定 Agent；Agent owner / workspace admin 可以编辑。复杂 private/shared/duplicate permission 留到 Phase 2。

### Prompt

Prompt 是用户可创建、可版本化、可绑定的一等资源。Prompt 可以用于 Agent 初始化，也可以用于 Project、Role、Playbook 或 Task context。

字段建议：

```yaml
prompt:
  id: prompt_delivery_contract
  owner_user_id: user_123
  name: 交付闭环要求
  description: 要求 agent 完成实现、验证、PR、部署和总结
  scope: agent
  kind: workflow
  visibility: workspace
  variables:
    - project_name
    - repository_slug
  active_version_id: prompt_delivery_contract_v2
  status: active
```

Prompt Version 字段建议：

```yaml
prompt_version:
  id: prompt_delivery_contract_v2
  prompt_id: prompt_delivery_contract
  version: 2
  body: |
    复现问题，定位根因，最小修复，补测试，通过后提 PR。
    完成后给出验证结果、风险和下一步。
  changelog: 增加部署验收要求
  content_hash: sha256:...
  status: active
  created_by: user_123
```

Prompt 属性约束：

- `scope=agent`: 用于初始化某个 User Agent。
- `scope=project`: 用于注入项目背景、repo、部署和协作规则。
- `scope=role`: 用于定义 Builder、Reviewer、Deploy 等角色职责。
- `scope=playbook`: 用于定义某个 workflow / node route 的执行规则。
- `scope=task`: 用于某类任务的补充上下文或输出要求。
- `scope=workspace`: 用于业务级全局安全边界和运行契约；它不是模型内置 system prompt，普通成员默认不可发布。

Prompt 只能叠加组合，不做隐式覆盖。相同 scope 内先按 order，再按绑定时间排序；不同 scope 使用固定顺序：agent -> project -> role -> playbook -> task -> workspace。若多个 prompt 对同一能力给出冲突要求，发布或创建 run 时必须给出 conflict warning；高风险权限、secret、部署、删除类冲突应阻断 run，直到用户调整绑定或明确选择更严格版本。

Prompt Phase 1 默认 workspace visible。同一 workspace 内用户可以查看和复用 Prompt；权限控制先放在编辑/删除动作上，private / project-only / team visibility 留到 Phase 2。

### Prompt Binding

Prompt Binding 决定某个 Prompt 被绑定到哪个对象，以及运行时如何参与初始化。

字段建议：

```yaml
prompt_binding:
  id: binding_agent_delivery_contract
  target_type: user_agent
  target_id: user_agent_codex_engineer
  prompt_id: prompt_delivery_contract
  version_policy: latest
  pinned_version_id: null
  scope: agent
  order: 20
  required: true
  status: active
```

绑定目标：

- User Agent
- Project
- Role
- Team
- Playbook
- Task / Run

Run 启动时必须冻结所有 Prompt Binding 和 Prompt Version。

Task / Run 层必须支持临时 Prompt。Run create page 的 instruction / extra prompt 作为 `scope=task` 的 task prompt 追加到 prompt stack，只对本次 run 生效，进入 run snapshot，但默认不保存到 Prompt Library。用户可以选择保存为可复用 Prompt。

### User Secret Vault

User Secret Vault 是用户级全局密码本。Secret 使用 key 管理，例如：

- `github_token`
- `gitlab_token`
- `dockerhub_token`
- `mbp_deploy_key`

Project、Repository、Agent 和 Run 只引用 secret key，不拥有 secret value。Run Context 和 Prompt Preview 展示本次 run 可用的 `available_secret_keys`。Agent 需要使用 secret 时，通过 runtime/tool 按 key 请求；Worker 负责解析 value 并执行工具动作。

Phase 1 不做复杂 secret allowlist，但不预注入全量 secret value。Secret 的细粒度权限、Reveal、审计隔离和脱敏治理放 Phase 2。

### Project

Plane project 是用户工作的主要上下文。一个 project 可以绑定多个 registered repository、多个 User Agent、多个 Project Prompt、多个 Agent Box 和多套 playbook。

Project 需要有自己的 Project Workspace。Project Workspace 是 Plane 上可编辑的逻辑工作区配置，不等于直接暴露给用户维护的裸文件路径。它定义 project 的 repo、artifact、memory、worker pool 和 workspace policy；Agent Control Plane / Worker 根据该配置生成 runtime path projection。

- 存放 repository checkout / worktree。
- 存放 run artifact、handoff notes、本地缓存和项目级 memory。
- 在 Plane 上编辑和维护配置。
- 由 Agent Control Plane / Worker 管理真实路径、安全校验和执行时映射。
- Plane 展示 workspace 状态和 validation 结果，不直接读写 worker 本机目录。

示例：

```text
Project: Plane 自研部署
Project Workspace:
  id: workspace_plane_self_hosted
  root policy: worker-managed
  default worker: Mac Studio
Repos:
  - michaelx1993/plane
User Agents:
  - 我的 Codex 工程师
  - 我的 Code Reviewer
  - 我的 Release Manager
Project Prompts:
  - Plane 自研部署背景
  - MBP 部署与 release 规则
Agent Boxes:
  - plane-codex-dev-box
  - plane-release-box
Teams:
  - Fix + Release Team
  - UI Localization Team
Playbooks:
  - 修复 bug + PR + release + deploy
  - 双语 UI 开发
  - Docker 镜像发布
```

Project Workspace 还拥有 Project Meta Git。Meta Git 是项目记忆底座，默认本地创建在 worker workspace root 下；后续可配置远程同步。不同 Project 的 Meta Git 独立，避免状态和进度混在一起。

### Project Meta Git

Project Meta Git 是每个 Project Workspace 的项目记忆 repo。Phase 1 默认本地 git；Phase 2 支持自动创建远程仓库并定时同步。

默认结构：

```text
status.md
progress.md
runs/
  <run_id>.md
playbooks/
  <playbook_id>.snapshot.md
artifacts/
  index.md
```

文件语义：

- `status.md`: 当前项目事实快照，包含需求、测试状态、review 状态、release 状态、deployment 状态、风险和下一步。可以通过 Plane Status 表单编辑。
- `progress.md`: 项目历史进展流水，只能 append，不允许改写旧历史。写错时追加 correction entry。
- `runs/<run_id>.md`: 单次 run 的完整摘要。
- `playbooks/<playbook_id>.snapshot.md`: 创建 run 时冻结的流水线配置。
- `artifacts/index.md`: Change Request、release、image、deployment evidence 等索引。

写入触发：

- node completed / failed / blocked。
- human gate action。
- user manual status edit。
- user manual progress append。

每次写入都生成 git commit。Node started 是否写入 Phase 1 不强制，避免频繁 commit。Agent 可以读取 Project Meta Git，但写入必须经 Plane / ACP / Worker 渲染，不允许 Agent 或用户绕过 Plane 直接改文件。

### Repository

Repository 是 Project 下的代码入口。第一阶段，所有 agent run 都必须选择一个已注册 repository。

字段建议：

```yaml
repository:
  id: repo_plane
  project_id: plane_self_hosted
  scm_provider: github
  owner: michaelx1993
  name: plane
  full_name: michaelx1993/plane
  default_branch: preview
  clone_url: git@github.com:michaelx1993/plane.git
  credential_ref: github_ssh_key_plane
  local_path: /agent-workspaces/projects/plane-self-hosted/repos/plane
  worktree_strategy: per_run
  status: active
```

约束：

- Phase 1 创建 run 时 `repository_id` 必填。
- Repository 必须属于当前 project。
- Worker 不使用 Plane 中的 repo label 猜测仓库；必须使用 Control Plane 下发的 repository snapshot。
- 每个 development run 默认基于 repository default branch 创建独立 work branch / git worktree。
- Change Request target 默认是 repository default branch；Run 创建时可覆盖 target branch。
- 后续可以扩展 repo-less task，但不能混入 Phase 1 的代码执行链路。

Phase 1 默认 `worktree_strategy=per_run`。Worker 为每个 run 创建独立 git worktree，run snapshot 记录 base branch、target branch、work branch 和 worktree path。完成后的 worktree 保留 TTL 方便复盘，过期后由 worker cleanup 清理；active、leased、human gate 中的 worktree 不得清理。

### Project Agent Binding

Project Agent Binding 决定某个 User Agent 在 project 中如何使用。

字段建议：

```yaml
project_agent_binding:
  project_id: plane_self_hosted
  user_agent_id: user_agent_codex_engineer
  is_project_default: true
  prompt_bindings:
    - prompt_id: prompt_plane_delivery_style
      version_id: prompt_plane_delivery_style_v1
      scope: project
      order: 30
  allowed_roles:
    - builder
    - reviewer
  default_role: builder
  default_box: plane-codex-dev-box
  permission_overrides:
    deploy: false
  status: active
```

### Agent Box

Agent Box 是 project/repo 绑定的执行环境配置。Agent Box 不拥有 Agent，它只提供 workspace、runtime、worker pool 和部署目标。

字段建议：

- name
- project binding
- repository binding
- project workspace binding
- workspace strategy
- default branch
- default worker pool
- allowed execution adapters
- secret provider reference
- deployment target reference
- concurrency limits

Phase 1 可以弱化 Agent Box，把用户可见配置收敛为 Worker Card + workspace policy。Worker Card 展示真实机器状态，例如 name、online/busy/offline、hostname、OS、workspace root、labels、last seen 和 current runs。

### Role

Role 是 runtime 的一等公民，不只是 UI 标签。Role 回答“这一步的职责、权限和输出契约是什么”。User Agent 回答“由哪个用户级 agent 来承担这个 role”。

字段建议：

```yaml
role:
  id: builder
  name: Builder
  description: 实现代码、补测试、开 PR
  prompt_bindings:
    - prompt_id: prompt_role_builder
      version_id: prompt_role_builder_v3
      scope: role
      order: 10
  permissions:
    read_files: true
    write_files: true
    run_tests: true
    create_pr: true
    merge_pr: false
    release: false
    deploy: false
  output_contract:
    required:
      - diff_summary
      - tests_run
      - risk_notes
```

第一版内置角色：

- Intake
- Planner
- Scout
- Builder
- Reviewer
- QA
- Merge
- Release
- Deploy
- Security Reviewer

Role 可以来自系统默认库、用户级模板或项目级 override。第一版优先实现系统默认 Role + 用户级 Prompt override；Project 只做绑定和权限收紧。

### Role Prompt

Role Prompt 是 `scope=role` 的 Prompt。编辑 Prompt 不覆盖历史版本，而是创建新版本。用户级 Role Prompt 是默认复用单元；项目可以绑定特定版本，也可以创建项目级补充 Prompt。所谓 override 只能通过显式绑定新 Prompt 或新版本实现，不能在运行时隐式覆盖既有 Prompt。

运行时 prompt 由以下部分组成：

```text
Agent prompts
+ Project prompts
+ Role prompts
+ Playbook prompts
+ Task prompts
+ Workspace prompts
+ Prior role handoff notes
```

字段建议：

- role_id
- version
- title
- body
- changelog
- author
- status: draft / active / archived
- content_hash
- created_at
- activated_at

### Agent Team

Agent Team 是一组 Playbook node 的 Agent assignment template。每个 node 由一个 User Agent 执行。Team 不是“多个 Agent 同时聊天”的抽象，而是“这个流程每个节点默认交给谁”的模板。

字段建议：

```yaml
team:
  id: fix_release_team
  name: Fix + Release Team
  node_assignments:
    - node_id: intake
      role: planner
      default_user_agent: user_agent_codex_engineer
      order: 10
    - node_id: development
      role: builder
      default_user_agent: user_agent_codex_engineer
      order: 20
    - node_id: code_review
      role: reviewer
      default_user_agent: user_agent_code_reviewer
      order: 30
    - node_id: qa
      role: qa
      default_user_agent: user_agent_code_reviewer
      order: 40
    - node_id: release
      role: release
      default_user_agent: user_agent_release_manager
      order: 50
    - node_id: deployment
      role: deploy
      default_user_agent: user_agent_release_manager
      order: 60
  fallback_agent: project_default_agent
```

第一版可以按顺序执行。后续再支持并行 node、文件锁和冲突协调。

### Playbook

Playbook 描述一次任务如何从输入走到完成。

字段建议：

```yaml
playbook:
  id: fix_pr_release_deploy
  name: 修复 bug + PR + release + deploy
  default_team: fix_release_team
  nodes:
    - id: intake
      role: planner
      state: Todo
    - id: development
      role: builder
      state: Development
    - id: code_review
      role: reviewer
      state: Code Review
    - id: merge
      role: merge
      state: In Merge
    - id: release
      role: release
      state: In Release
    - id: deployment
      role: deploy
      state: Deployment
  routes:
    intake: development
    development: code_review
    code_review: human_review
    human_review: merge
    merge: ready_for_release
    ready_for_release: release
    release: ready_for_deployment
    ready_for_deployment: deployment
  human_gates:
    - Human Review
    - Ready for Release
    - Ready for Deployment
  completion:
    final_state: Done
```

Playbook 可以继承 Symphony 的 Liquid 条件 prompt 路由，但在产品上展示为结构化 node + route。每个 node 必须 resolve 到一个 User Agent 后才能启动 run。

Phase 1 推荐默认开发流水线：

```text
Development
-> Agent Code Review
-> Human Review Gate
-> Merge
-> Human Gate / Ready for Release
-> Release
-> Human Gate / Ready for Deployment
-> Deployment
-> Done
```

Development / Builder node 成功完成后必须创建或更新 Change Request。Agent Code Review node 读取 Change Request diff、测试结果和 developer handoff，输出 `approve`、`request_changes` 或 `needs_human`。Agent Review 不通过时自动打回 Development rework，由 RD / Builder Agent 复用同一个 work branch 和 Change Request 继续开发。

Human Review 是独立 gate，不属于 Agent Review。Human Review 通过后，用户可以把 run 拖到 Merge node，由 Merge Agent 合并到 target branch。Release 指发布制品/镜像，例如 tag、release notes、Docker image 和 image digest；Deployment 才是真正部署。Release 完成后仍进入 Human Gate，用户再把 run 推进到 Deployment node。

每条 transition 都有 gate mode：

- `manual`: 当前节点完成后停住，等待用户拖到下一节点。
- `auto`: 当前节点成功后自动进入下一节点。
- `conditional`: 满足条件自动，否则停在 Human Gate。

Playbook template 提供默认 gate mode；Run 创建时复制出一条可编辑 Run Pipeline。用户可以在 run 运行期间把任意 gate / transition 从 `manual` 改成 `auto`，或从 `auto` 改回 `manual`。如果 run 正停在该 gate，切到 `auto` 后立即尝试进入下一节点；若 prerequisite 不满足，则保持 blocked 并显示缺失项。

用户可以把 run 手动拖到任意 node。系统先记录 manual move，再检查该 node 的 prerequisite；满足则启动对应 Agent，不满足则停在该 node 并显示 `missing prerequisites`。

默认 prerequisite 示例：

- Development: repository selected、worker selected、task instruction exists。
- Agent Code Review: change_request_url exists、work_branch exists、diff exists。
- Merge: change_request_url exists、human_review_approved=true、checks_passed=true。
- Release: merge_commit_sha exists、target_branch exists。
- Deployment: release_artifact exists、target_environment selected。

Node 输出需要标准化，便于 Plane 计时板统一展示：

- status
- started_at / finished_at / duration
- output_summary
- artifacts
- next_action
- failure_type / failure_reason

### Run Assignment

Run Assignment 是一次 run 中 `playbook node -> user agent` 的冻结映射。

字段建议：

```yaml
run_assignment:
  run_id: run_123
  repository_id: repo_plane
  playbook_id: fix_pr_release_deploy
  team_id: fix_release_team
  node_assignments:
    - node_id: intake
      user_agent_id: user_agent_codex_engineer
      source: team_default
    - node_id: development
      user_agent_id: user_agent_codex_engineer_high_reasoning
      source: run_override
    - node_id: code_review
      user_agent_id: user_agent_code_reviewer
      source: team_default
    - node_id: release
      user_agent_id: user_agent_release_manager
      source: project_default
```

Node assignment resolution order:

1. 本次 run 显式指定的 `node -> user agent`。
2. selected Team 的 node 默认 agent。
3. Project 对该 role/node 的默认 agent binding。
4. Project default agent。
5. 如果仍无法 resolve，则禁止启动 run。

通用 default agent 只做兜底，不改变“每个 node 由一个 Agent 执行”的原则。

### Run Snapshot

每次 run 启动时，Control Plane 必须冻结执行快照。

快照至少包含：

- owner user
- project
- project workspace
- project meta context
- task
- registered repository
- base branch / target branch / work branch
- node assignment snapshot
- user agent versions
- box
- worker card
- team version
- playbook version
- run pipeline gate modes
- prompt bindings and prompt versions
- rendered prompt hash
- assembled prompt preview
- available secret keys
- runtime permissions
- worker execution profile

快照不可变。后续 User Agent、Prompt、Prompt Binding 或 playbook 被修改，不影响旧 run 的复盘。

## Plane 页面设计

### Project Command Center

Project Command Center 是 Plane 中的项目作战面板。Plane 是唯一入口；Project Meta Git 只是背后的项目记忆存储。

建议页面结构：

```text
Project
  Overview
  Pipeline
  Memory
  Runs
  Artifacts
  Settings
```

`Overview` 展示项目当前状态：

- project health
- current active run
- current node
- current agent
- current worker
- latest Change Request
- latest release image / artifact
- latest deployment status
- next action

`Pipeline` 展示运行中流水线：

- 横向展示 Playbook nodes 和 Human Gates。
- 支持把 run 拖到任意 node。
- 支持对 gate / transition 动态切换 `manual` / `auto`。
- 节点 blocked 时显示 missing prerequisites。
- 点击节点查看 input、output、耗时、Agent、Worker、日志摘要和 artifacts。

`Memory` 展示 Project Meta Git 的结构化视图：

- Status tab: 通过表单编辑 `status.md`，表示项目当前快照。
- Progress tab: 只能追加 entry，对应 append-only `progress.md`。
- Raw tab: 只读查看 `status.md` / `progress.md` 原文，便于调试和导出。

`Runs` 展示历史流水线列表和 run detail 入口。`Artifacts` 展示 Change Request、commits、test reports、release tags、image tags/digests、deployment URLs、logs、screenshots 和 health checks 索引。

### User Agent Library

```text
User Settings: Agent Library

My Agents
Prompt Library
Team Templates
Playbook Templates
```

列表展示：

- agent name
- owner
- default model
- default role
- linked projects
- last used
- success rate

操作：

- create user agent
- bind prompts to agent
- duplicate agent
- archive agent
- create prompt
- edit prompt
- configure prompt binding version policy
- preview assembled prompt
- create team template
- create playbook template

### Project Agents Overview

```text
Project: Plane 自研部署

[让 agent 做什么?____________________] [Repository] [Playbook] [Assignment] [Run]

Active Runs
Failed Runs
Waiting for Human Gate
Recent PRs
Deployments
```

### Project Workspace

列表展示：

- workspace name
- workspace policy
- repository root
- run artifact root
- worker host availability

操作：

- set project workspace policy
- validate workspace
- open recent run artifacts

### Repositories

列表展示：

- repository full name
- provider
- default branch
- clone URL type
- credential reference
- local path
- last sync / last run

操作：

- register repository
- validate credential
- update default branch
- archive repository

### Project Agent Bindings

列表展示：

- user agent name
- allowed roles
- project prompt bindings
- project default agent
- default role
- default Agent Box
- project permission overrides
- last run

操作：

- bind user agent
- unbind user agent
- bind project prompt
- set project default agent
- set default role
- set project-specific permission override

### Roles

列表展示：

- role name
- active prompt version
- prompt bindings
- permissions summary
- linked teams
- last used
- success rate

操作：

- create role
- edit role prompt
- configure role prompt binding version policy
- archive role
- duplicate role

### Teams

列表展示：

- team name
- playbook nodes
- default user agents
- node assignments
- default playbooks
- recent runs

操作：

- create team
- reorder roles
- assign role permissions override
- duplicate team

### Playbooks

列表展示：

- playbook name
- route graph
- human gates
- default team
- linked boxes

操作：

- create playbook
- edit route
- bind default team
- publish new version

### Issue / Work Item Action

Plane work item 页面新增：

```text
Run with Agent
```

触发参数：

- Repository
- target branch override
- Node Agent Assignments
- Worker Card
- Team
- Playbook
- optional instruction
- assembled prompt preview
- gate mode overrides
- available secret keys

Phase 1 规则：

- `Repository` 必填。
- Project default worker 默认选中，用户可以覆盖 Worker Card。
- 每个 Playbook node 必须 resolve 到一个 User Agent。
- 未显式选择 node agent 时，使用 Team default、Project role/node default 或 Project default agent 兜底。
- Development node 成功后必须创建或更新 Change Request。
- Run 创建时必须冻结 prompt preview、worker、branch、pipeline gate modes 和 available secret keys。

## API 边界

Plane 产品层是编辑边界。Plane UI 调用 Plane extension API 来维护 User Agent、Prompt、Project Workspace、Repository、Role、Team 和 Playbook 的可编辑配置；Plane 再把运行所需的 versioned projection 同步给 Agent Control Plane。

Agent Control Plane API 不承担普通用户编辑体验，它承担 projection 接收、run 创建、assignment resolve、snapshot 冻结和 Worker API。下面端点以 Plane extension API 的形态描述；对应的 Control Plane 同步端点应使用内部 contract 或 event sync 实现。

```text
GET    /api/users/me/agents
POST   /api/users/me/agents
GET    /api/users/me/agents/:agentId
PATCH  /api/users/me/agents/:agentId
POST   /api/users/me/agents/:agentId/prompt-bindings
PATCH  /api/users/me/agents/:agentId/prompt-bindings/:bindingId
DELETE /api/users/me/agents/:agentId/prompt-bindings/:bindingId

GET    /api/users/me/prompts
POST   /api/users/me/prompts
GET    /api/users/me/prompts/:promptId
PATCH  /api/users/me/prompts/:promptId
POST   /api/users/me/prompts/:promptId/versions
POST   /api/users/me/prompts/:promptId/versions/:versionId/activate

GET    /api/users/me/team-templates
POST   /api/users/me/team-templates
PATCH  /api/users/me/team-templates/:teamTemplateId
POST   /api/users/me/team-templates/:teamTemplateId/publish

GET    /api/users/me/playbook-templates
POST   /api/users/me/playbook-templates
PATCH  /api/users/me/playbook-templates/:playbookTemplateId
POST   /api/users/me/playbook-templates/:playbookTemplateId/publish

GET    /api/projects/:projectId/agents/summary

GET    /api/projects/:projectId/workspace
PATCH  /api/projects/:projectId/workspace
POST   /api/projects/:projectId/workspace/validate

GET    /api/projects/:projectId/repositories
POST   /api/projects/:projectId/repositories
GET    /api/projects/:projectId/repositories/:repositoryId
PATCH  /api/projects/:projectId/repositories/:repositoryId
POST   /api/projects/:projectId/repositories/:repositoryId/validate
POST   /api/projects/:projectId/repositories/:repositoryId/archive

GET    /api/projects/:projectId/agent-bindings
POST   /api/projects/:projectId/agent-bindings
PATCH  /api/projects/:projectId/agent-bindings/:bindingId
DELETE /api/projects/:projectId/agent-bindings/:bindingId

GET    /api/projects/:projectId/prompt-bindings
POST   /api/projects/:projectId/prompt-bindings
PATCH  /api/projects/:projectId/prompt-bindings/:bindingId
DELETE /api/projects/:projectId/prompt-bindings/:bindingId

GET    /api/projects/:projectId/agent-boxes
POST   /api/projects/:projectId/agent-boxes

GET    /api/projects/:projectId/roles
POST   /api/projects/:projectId/roles
GET    /api/projects/:projectId/roles/:roleId
PATCH  /api/projects/:projectId/roles/:roleId
POST   /api/projects/:projectId/roles/:roleId/prompt-bindings
PATCH  /api/projects/:projectId/roles/:roleId/prompt-bindings/:bindingId
DELETE /api/projects/:projectId/roles/:roleId/prompt-bindings/:bindingId

GET    /api/projects/:projectId/teams
POST   /api/projects/:projectId/teams
PATCH  /api/projects/:projectId/teams/:teamId
POST   /api/projects/:projectId/teams/:teamId/node-assignments
PATCH  /api/projects/:projectId/teams/:teamId/node-assignments/:assignmentId
DELETE /api/projects/:projectId/teams/:teamId/node-assignments/:assignmentId

GET    /api/projects/:projectId/playbooks
POST   /api/projects/:projectId/playbooks
PATCH  /api/projects/:projectId/playbooks/:playbookId
POST   /api/projects/:projectId/playbooks/:playbookId/publish

GET    /api/projects/:projectId/memory/status
PATCH  /api/projects/:projectId/memory/status
GET    /api/projects/:projectId/memory/progress
POST   /api/projects/:projectId/memory/progress
GET    /api/projects/:projectId/memory/artifacts

POST   /api/projects/:projectId/prompt-preview

POST   /api/projects/:projectId/runs
GET    /api/projects/:projectId/runs
POST   /api/projects/:projectId/runs/resolve-assignment
GET    /api/runs/:runId
GET    /api/runs/:runId/prompt-preview
POST   /api/runs/:runId/pipeline/gates/:gateId/mode
POST   /api/runs/:runId/pipeline/move
POST   /api/runs/:runId/approve
POST   /api/runs/:runId/cancel
POST   /api/runs/:runId/retry
```

Worker 不调用 Plane。Worker 只调用 Control Plane Worker API。

## 与 Symphony 的迁移关系

旧 Symphony 概念到新平台的映射：

| Symphony                   | 新平台                                 |
| -------------------------- | -------------------------------------- |
| `WORKFLOW.md`              | Playbook                               |
| YAML front matter          | Playbook / Box runtime config          |
| Liquid 条件                | Playbook route rules                   |
| role-specific prompt block | Role Prompt Version                    |
| agent-specific base prompt | User Agent Prompt Version              |
| prompt source              | Prompt + Prompt Binding                |
| repo label / branch        | Registered Repository                  |
| Linear issue               | Plane work item / ACP task mirror      |
| issue state routing        | Run state routing                      |
| Codex Workpad comment      | Run Workpad / Handoff Notes            |
| per-issue workspace        | Agent Box workspace / per-run worktree |
| Codex app-server           | ExecutionAdapter                       |
| structured logs            | Run Events                             |

迁移原则：

- 保留 Symphony 的执行链路。
- 把 Markdown prompt 升级为版本化 Prompt 和 Prompt Binding。
- 把 Liquid route 升级为结构化 Playbook node / route / node assignment。
- 把 Workpad 从 issue comment 升级为 Control Plane run artifact，再按需回写 Plane comment。

## 分阶段落地

### Phase 1: Control Plane 底层模型

- 新增或补齐 User Agent、Prompt、Prompt Version、Prompt Binding、Project Agent Binding、Repository、Project Workspace、Role、Team、Playbook、Run Assignment、Box、Run Snapshot 模型。
- Plane 作为 Agent / Prompt / Project Workspace 的编辑入口；Control Plane 保存 runtime projection 与 run snapshot。
- Worker claim 返回完整 snapshot。
- Phase 1 创建 run 时要求 `repository_id` 必填。
- Runtime 根据 snapshot 组合 prompt。
- Run events 记录 role enter/exit、handoff、permission decision。
- Prompt Binding 支持 `latest` / `pinned` version policy。
- Project Meta Git 本地 repo 可写入 `status.md`、append `progress.md`、生成 run summary 和 artifact index。
- Worker 支持 per-run git worktree 和 cleanup TTL。

### Phase 2: Plane User Agent Library

- 在 Plane user settings 内新增 `Agent Library` 页面。
- 页面通过 Plane extension API 管理 User Agents、Prompt Library、Prompt Bindings、Team templates 和 Playbook templates，并把可执行 projection 同步到 Control Plane。

### Phase 3: Plane Project Agents 页面

- 在 Plane project 内新增 `Agents` 页面。
- 页面通过 Plane extension API 管理 Project Workspace、Repositories、Project Agent Bindings、Project Prompt Bindings、Roles、Teams、Playbook Nodes、Node Assignments、Boxes，并把可执行 projection 同步到 Control Plane。
- 展示 run 列表和 run detail link。
- 新增 Project Command Center，包含 Overview、Pipeline、Memory、Runs、Artifacts。
- Memory 中 Status 可表单编辑，Progress 只能追加 entry。

### Phase 4: Plane Work Item Action

- 在 Plane work item 页面新增 `Run with Agent`。
- 从当前 project 读取 registered repositories、Project default agent、Agent Box、Team 和 Playbook。
- 布置任务时可以显式指定 Repository、target branch override、Worker Card、node agent assignments、gate mode overrides 和 task prompt。
- Run create page 必须展示 assembled prompt preview 和 available secret keys。
- 创建 Control Plane run。
- 将 run 状态、Change Request、release、deployment 结果摘要回写到 Plane work item。

### Phase 5: 多角色协作增强

- 支持同一 run 内多个 role stage。
- 支持 reviewer read-only、deployer release/deploy-only。
- 支持文件锁和并发角色。
- 支持 role-specific memory scope。
- 支持 Prompt A/B 和成功率统计。
- 支持 Project Meta Git remote auto-create 和 scheduled sync。
- 支持 private/project/team 级 Prompt / Agent visibility。
- 支持完整 secret 权限治理和 reveal/audit 隔离。

## 权限与审计

权限分两层：

- Plane 权限：谁可以查看、编辑、发布 user agent/prompt/role/team/playbook。
- Runtime 权限：role 在执行中能调用哪些工具。

关键审计事件：

- user agent created / updated / archived
- prompt created / updated / archived
- prompt version created / activated
- prompt binding created / updated / removed
- project agent binding created / updated / removed
- role created / updated / archived
- team created / updated
- team node assignment created / updated / removed
- playbook published
- run assignment resolved / overridden
- run snapshot created
- run pipeline gate mode changed
- run manually moved to node
- node prerequisite blocked
- human approval granted / denied
- project memory status updated
- project memory progress appended
- project meta git commit created
- runtime permission denied
- deploy/release action requested / completed

敏感边界：

- Prompt 可以包含流程规则，但不默认包含 secret 值。
- User Secret Vault 以 key 管理 secret；Run Context 展示 available secret keys。
- Secret value 只在 Agent 使用时由 worker runtime 按 key 解析。

## 取舍

### 为什么不是直接把所有数据存在 Plane DB？

短期看更简单，长期会让执行系统与 Plane schema 强耦合。Worker claim、prompt release、run snapshot 和审计都天然属于 Control Plane。Plane DB 不应成为 runtime 状态库。

### 为什么 Agent 是 User 级，而不是 Project 级？

Agent 表达用户常用的工作方式、偏好和默认 Prompt 绑定，它应该跨项目复用。Project 表达业务上下文、repo、环境和协作范围。把 Agent 放在 User 级，可以避免每个 project 都复制一份 agent 配置，也能让用户把自己的常用 agent 带到不同 project。

### 为什么还要在 Plane 上做管理入口？

用户以项目和任务为中心工作，但 Agent 是用户自己的常用工作能力。User Agent Library 放在用户级，Project Agents 放在项目级，可以同时满足跨项目复用和项目上下文绑定。Role、Team、Playbook 和 Node Assignment 如果留在单独后台，会让用户在 Plane 与 Control Plane 之间来回切换。管理入口放 Plane，可以让 agent 使用成为项目工作流的一部分。

### 为什么 Phase 1 要求必须有 Repository？

代码开发任务需要稳定的源码上下文、分支策略、测试命令和 PR 出口。第一阶段先强制绑定 registered repository，可以避免 agent 在缺少 repo 的情况下做不可验证的泛化执行。repo-less task 仍是合理方向，但应作为后续独立能力处理。

### 为什么第一版不做多个物理 Agent？

现有 Symphony 经验表明，按状态切换 Role Prompt 已经能覆盖第一批场景。多个物理 agent 会引入文件锁、冲突合并、成本控制和调度复杂度。第一版先把 User Agent、Prompt、Prompt Binding、snapshot 和 handoff 做对，再扩展并行。

## 剩余待决问题

- Prompt conflict policy 需要细化 UI 交互：低风险冲突只 warning，高风险权限、secret、部署和删除类冲突阻断 run；具体规则应在实现前形成枚举。
- Plane extension config 的持久化方式需要单独设计：可以是 Plane fork 内新增表，也可以是 Plane 插件/扩展表，但产品事实源必须留在 Plane 侧。
- Projection sync 需要定义版本号、幂等键、重试和回滚策略，避免 Plane 已发布配置但 Control Plane 运行快照仍使用旧版本。
- `Team` 名称可能误导用户以为是多个 Agent 同时聊天；实现 UI 时可以考虑展示为 `Assignment Template`，底层仍可保留 team 概念。
- SCM Provider 第一阶段可以只实现 GitHub，但字段和 UI 文案必须兼容 GitLab Merge Request。

## 验收标准

- Plane user settings 下能查看和管理 User Agents。
- Plane user settings 下能查看和管理 Prompt Library、Team Template 和 Playbook Template。
- Plane user settings 下能把一个或多个 Prompt 绑定到 User Agent 初始化链。
- Prompt Binding 能配置 `latest` 或 `pinned` 版本策略。
- Agent edit、Run create 和 Run detail 能展示 assembled prompt preview。
- Run create 能展示 available secret keys。
- Plane project 下能配置 Project Workspace。
- Plane project 下能配置 Project default Worker Card，Run 创建时可覆盖。
- Plane project 下能注册、验证和归档 Repositories。
- Plane project 下能绑定 User Agents、Project Prompts，并管理 Roles、Teams、Playbooks、Agent Boxes。
- Plane project 下能配置 Project default agent。
- Plane work item 能创建一次 agent run，并能显式指定 Repository、target branch override、Worker Card、node agent assignments、gate mode overrides 和 task prompt。
- Phase 1 中未选择 registered repository 时不能创建代码执行 run。
- Phase 1 中每个 Playbook node 都必须 resolve 到一个 User Agent，否则不能创建 run。
- Development node 成功后必须创建或更新 Change Request。
- Agent Code Review `request_changes` 能自动打回 Development rework。
- Human Gate 能动态切换 `manual` / `auto`。
- 用户可以把 run 拖到任意 node；prerequisite 不满足时显示 blocked 和 missing prerequisites。
- Control Plane 中能看到该 run 的 frozen snapshot。
- Worker claim 不依赖 Plane，能通过 snapshot 组合 prompt 并启动 Codex。
- Worker 为 development run 创建 per-run git worktree，并能按 TTL 清理过期 worktree。
- Run detail 能显示 user agent、role timeline、handoff notes、events、Change Request/release/deploy evidence。
- Project Command Center 能展示 Overview、Pipeline、Memory、Runs 和 Artifacts。
- Status 能通过 Plane 表单编辑并写入 `status.md`。
- Progress 能通过 Plane 追加 entry 并写入 append-only `progress.md`。
- Project Meta Git 能生成 `runs/<run_id>.md` 和 `artifacts/index.md`。
- 修改 Prompt、Prompt Binding 或 playbook 后，历史 run 仍能查看当时使用的 version/hash。
- Secret value 不预注入 prompt；Agent 使用时按 key 通过 worker runtime 解析。

## 后续文档

- `docs/symphony-orchestration-design.md`: 继续记录 Symphony 执行模型来源。
- `docs/agent-control-plane-prd.md`: 保持总体产品和系统边界。
- `docs/plane-agent-platform-erd.md`: 记录 Plane extension tables、ACP projection tables、Run Pipeline、Project Meta Git 和相关 ERD 技术方案。
- 后续实现时应新增 API contract 和 migration design，分别描述 Control Plane API、DB migration 和 Plane UI 改造范围。
