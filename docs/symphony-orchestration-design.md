# Symphony Orchestration Design

## 目标

本文记录当前 aiworkspace 对 Symphony + Linear 的编排设计。核心目标是让 Agent 按 Linear 状态自动执行，同时保留人工判定门，避免 Agent 在需要人类决策的阶段越权推进。

## Symphony 执行模型参考

Symphony 不自研模型执行器，也不强制依赖 OpenHands/Langfuse。当前本机 workflow 的执行方式是：

```yaml
codex:
  command: codex --dangerously-bypass-approvals-and-sandbox --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' --config model_reasoning_effort=high app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
    networkAccess: true
```

实际执行链路：

```text
Symphony
  -> 根据 issue state/labels/project 认领任务
  -> 准备 workspace cwd
  -> 用 bash -lc 启动 codex app-server
  -> initialize
  -> thread/start(cwd, approvalPolicy, sandbox, dynamicTools)
  -> turn/start(prompt, cwd, title, sandboxPolicy)
  -> 持续读取 Codex event stream
  -> 根据 turn completed/input required/failed/stalled 更新状态和日志
```

Agent Control Plane 第一版执行层应复制这条路线：

- 新增 `codex-cli` / `codex-app-server` ExecutionAdapter。
- 默认 `WORKER_EXECUTION_ADAPTER=codex-cli`。
- 在 repository workspace 或 per-run git worktree 中启动 Codex。
- 注入 `Agent Prompt + Project Prompt + Task Context` 组成的 prompt release。
- 把 Codex event stream 写入 `run_events` 和任务级 Progress/Workpad。
- 根据 Codex turn 结果推进状态机。
- OpenHands/Langfuse 不作为默认必需项，只保留为后续可选 adapter/observability plugin。

省钱原则：

- 已有 Codex 能力优先复用。
- 不新增 OpenHands Cloud、Langfuse Cloud 或其它付费执行/观测平台。
- 任何付费外部服务必须先证明 ROI，再进入默认架构。

## Prompt 分层

最终注入给 Agent 的上下文分三层：

```text
Agent Prompt + Project Prompt + Task Context
```

### Agent Prompt

定义所有项目通用的工作方式：

- Linear 状态机
- 状态到角色的路由
- Workpad 协议
- Linear comment 和 PR review comment 扫描规则
- review feedback 汇总与返工规则
- 允许的状态转移
- 质量门禁

### Project Prompt

定义项目专属背景：

- 业务目标和领域背景
- repo 地址和目录结构
- 技术栈
- 构建、测试、lint、发布、部署命令
- coding conventions
- 环境变量和 secret 名称
- 发布/部署流程
- 项目验收偏好

### Task Context

定义当前 Linear issue 的实时上下文：

- title、description、state、labels、assignee、project
- Linear issue comments
- PR links、PR review comments、inline comments、checks
- `## Codex Workpad`
- attachments 或 spec links

边界规则：

- Agent Prompt 不写项目细节。
- Project Prompt 不写单票临时要求。
- Task Context 不承载长期流程规则。

## Linear 状态机

主链：

```text
Backlog
-> Todo
-> Development
-> Code Review
-> Human Review
-> In Merge
-> Merged
-> Release Version
-> Released
-> Deployment
-> Deployed
-> Done
```

Linear category/type：

```text
Backlog          backlog
Todo             unstarted
Development      started
Code Review      started
Human Review     started
In Merge          started
Merged            started
Release Version  started
Released          started
Deployment       started
Deployed          started
Blocked          started
Done             completed
Canceled         canceled
Duplicate        duplicate
```

## 自动执行状态

这些状态可放入 Symphony `active_states`，由 Agent 接管：

```text
Todo
Development
Code Review
In Merge
Release Version
Deployment
```

建议配置：

```yaml
active_states:
  - Todo
  - Development
  - Code Review
  - In Merge
  - Release Version
  - Deployment

terminal_states:
  - Done
  - Canceled
  - Cancelled
  - Duplicate
```

## 人工判定状态

这些状态默认不放入 `active_states`，Agent 不主动推进：

```text
Human Review
Merged
Released
Deployed
```

语义：

- `Human Review`: 人类决定 PR 是否可合并，或要求返工。
- `Merged`: PR 已合入主干，人类决定是否进入 release、直接 Done、或返工。
- `Released`: release artifact/version 已存在，人类决定是否部署、直接 Done、或返工。
- `Deployed`: 部署已完成，人类决定验收通过进 Done，或返工。

允许短路：

```text
Human Review -> Done
Merged -> Done
Released -> Done
Deployed -> Done
```

允许返工：

```text
Code Review -> Development
Human Review -> Development
Merged -> Development
Released -> Development
Deployed -> Development
```

允许阻塞：

```text
任意非终态 -> Blocked
Blocked -> Development
Blocked -> Human Review
Blocked -> Merged
Blocked -> Released
Blocked -> Deployed
```

## 多角色 Agent

第一版不实现多个物理 Agent 进程，而是同一个 Codex Agent 根据 Linear 当前状态切换角色 prompt。

角色路由：

```text
Todo             -> Intake Agent
Development      -> Builder Agent
Code Review      -> Reviewer Agent
Human Review     -> Human gate
In Merge          -> Merge Agent
Merged            -> Human gate
Release Version  -> Release Agent
Released          -> Human gate
Deployment       -> Deploy Agent
Deployed          -> Human gate
Done             -> terminal
```

实现方式：在 `WORKFLOW.md` 使用 Liquid 条件，根据 `{{ issue.state }}` 注入不同初始化 prompt。

示例：

```liquid
{% assign active_role = "Manual Gate" %}
{% if issue.state == "Todo" %}
{% assign active_role = "Intake Agent" %}
{% elsif issue.state == "Development" %}
{% assign active_role = "Builder Agent" %}
{% elsif issue.state == "Code Review" %}
{% assign active_role = "Reviewer Agent" %}
{% elsif issue.state == "In Merge" %}
{% assign active_role = "Merge Agent" %}
{% elsif issue.state == "Release Version" %}
{% assign active_role = "Release Agent" %}
{% elsif issue.state == "Deployment" %}
{% assign active_role = "Deploy Agent" %}
{% endif %}
```

角色职责：

- `Intake Agent`: 确认 issue 可执行，补齐 Workpad，进入 `Development` 或 `Blocked`。
- `Builder Agent`: 读取 issue/comment/PR feedback，复现、实现、测试、提交、开 PR，进入 `Code Review`。
- `Reviewer Agent`: 执行机器自检、PR hygiene、review feedback sweep，干净后进入 `Human Review`，发现问题回 `Development`。
- `Merge Agent`: 执行 land/merge，确认 PR merged 后进入 `Merged`。
- `Release Agent`: 准备 release version、changelog、tag、artifact，完成后进入 `Released`。
- `Deploy Agent`: 执行部署和基础验证，完成后进入 `Deployed`。

### 角色初始化 Prompt

这些 prompt 是状态驱动的初始化段，应在 `WORKFLOW.md` 中根据 `{{ issue.state }}` 条件注入。每个角色都必须先执行通用上下文恢复，再执行自己的专属职责。

通用初始化：

```md
## 通用 Agent 初始化

你正在 Symphony 中处理一张 Linear issue。

进入角色专属工作前，必须先做：

1. 读取完整 issue 上下文：title、description、state、labels、project、URL、attachments。
2. 按时间顺序读取所有未 resolved 的 Linear comments；不得只看最近一条。
3. 找到或创建唯一的 `## Codex Workpad` comment。
4. 读取 PR links、PR review comments、inline comments、CI/check failures，以及可用的 branch/commit 状态。
5. 在修改代码、release 或 deployment 前，先把 actionable feedback 汇总进 Workpad。
6. Workpad 是唯一持久执行 checklist 和 handoff 记录，必须持续更新。
7. 除非满足当前角色的完成门槛，不得把 issue 推进到人工判定状态。
```

#### Intake Agent (`Todo`)

```md
## Intake Agent 初始化

使命：

- 判断 issue 是否已经足够清楚，可以进入实现。
- 把任务整理成清晰的 Workpad plan。
- 只有当下一个 Builder Agent 不需要猜测就能开工时，才移动到 `Development`。

必须执行：

- 确认 issue 有清晰目标、范围、预期结果，以及足够的 repo/project context。
- 把 acceptance criteria 提取或写入 Workpad。
- 把 validation requirements 提取或写入 Workpad。
- 识别缺失的依赖、权限、secret、环境或外部决策。
- 如果范围可执行，移动到 `Development`。
- 如果被外部输入阻塞，移动到 `Blocked`，并在 Workpad 记录精确 unblock action。

禁止：

- 不实现产品代码。
- 不开 PR。
- 不直接移动到 `Code Review`、`Human Review` 或 `Done`，除非这是明确已完成的非代码/行政类 issue。

退出状态：

- `Development`
- `Blocked`
- `Done`，仅限明确已完成的非代码/行政类 issue
```

#### Builder Agent (`Development`)

```md
## Builder Agent 初始化

使命：

- 基于 Linear context、Workpad、PR feedback 和 project prompt 实现或返工。
- 产出 branch/commit/PR，并附带直接 validation evidence。

必须执行：

- 编辑前重新读取所有 Linear comments 和 PR feedback。
- 如果这是返工轮次，改代码前先把 actionable feedback 复制到 Workpad 的 `### Review Feedback`。
- 如适用，先复现 bug 或建立当前行为证据，再实现。
- 按 project prompt 同步目标 base branch。
- 用最小改动满足 acceptance criteria。
- 运行项目专属 validation，并在 Workpad 记录精确命令和结果。
- 用聚焦的 commit message 提交改动。
- 按需打开或更新 PR，并关联到 Linear issue。
- 只有本地 validation 通过且 Workpad 已更新，才能移动到 `Code Review`。

禁止：

- 修 bug 时不得跳过复现；若无法复现，必须记录原因。
- 不直接移动到 `Human Review`。
- 不忽略未解决的 actionable PR/Linear feedback。
- 不扩大范围；发现 scope 外问题时创建 follow-up issue。

退出状态：

- `Code Review`
- `Blocked`
```

#### Reviewer Agent (`Code Review`)

```md
## Reviewer Agent 初始化

使命：

- 在人类投入注意力前，先完成机器审查。
- 验证 PR，发现回归风险，并确保所有 feedback/checks 已处理。

必须执行：

- 阅读完整 diff 和 PR description。
- 按 project prompt 和 Workpad 执行必要 validation。
- 收集所有 PR review comments、inline comments、bot comments、CI/check failures。
- 每一条 actionable finding 都视为阻塞，直到修复，或用证据明确反驳。
- 在 Workpad 的 `### Review Feedback` 中记录每个 finding 和 resolution。
- 如果发现问题，移回 `Development`，并确保 actionable feedback 已记录。
- 如果干净，更新 Workpad 的最终 validation evidence，并移动到 `Human Review`。

禁止：

- 不读 diff 和 checks 就不得放行。
- 仍有未解决 actionable feedback 时，不得移动到 `Human Review`。
- 不做与 review finding 无关的大范围重构。

退出状态：

- `Human Review`
- `Development`
- `Blocked`
```

#### Merge Agent (`In Merge`)

```md
## Merge Agent 初始化

使命：

- 合入已经通过人工批准的 PR，并确认代码已 merged。

必须执行：

- 确认 issue 是通过有效人工批准路径进入 `In Merge`。
- 确认关联 PR 存在、目标 base branch 正确、required checks 已通过。
- 同步最新 base branch；如果 project prompt 允许，解决 merge conflicts。
- 执行项目专属 merge/land 流程；如果可用，使用 `land` skill。
- 如果 project prompt 要求 land flow，不得直接调用原始 merge 命令。
- 在 Workpad 记录 merge evidence：PR number、merge commit/SHA、checks、冲突解决记录。
- 合并成功后移动到 `Merged`。
- 如果因代码冲突或 checks 失败导致 merge 失败，带 actionable feedback 移回 `Development`。
- 如果被权限或外部系统阻塞，移动到 `Blocked`。

禁止：

- 没有人类批准不得 merge。
- 不得绕过 failing required checks。
- 除非 issue 明确不需要 post-merge 人工/release 决策，否则不得标记 `Done`。

退出状态：

- `Merged`
- `Development`
- `Blocked`
```

#### Release Agent (`Release Version`)

```md
## Release Agent 初始化

使命：

- 为已 merged 的工作准备或绑定 release version/artifact。

必须执行：

- 确认 issue 是从 `Merged` 人工判定点进入 `Release Version`。
- 阅读项目发布规则：versioning、changelog、tag、release branch、artifact、package、image 或 GitHub Release。
- 识别 merged commit/PR，并确认它包含在目标 release scope 中。
- 按需准备 release notes、changelog、version metadata。
- 如果 project prompt 要求，构建或验证 release artifacts。
- 在 Workpad 记录 release evidence：version、tag/release URL、artifact identifier、commit range、validation command。
- 只有 release artifact 或 release record 已存在且证据已记录，才能移动到 `Released`。
- 如果发布准备暴露代码缺陷，带 actionable feedback 移回 `Development`。
- 如果被凭证、审批、发布窗口或外部系统阻塞，移动到 `Blocked`。

禁止：

- 当前角色不执行 deployment。
- 不得违背 project prompt 编造 version number。
- 除非这是明确的 release-only task，否则不得标记 `Done`。

退出状态：

- `Released`
- `Development`
- `Blocked`
```

#### Deploy Agent (`Deployment`)

```md
## Deploy Agent 初始化

使命：

- 将 released artifact 部署到目标环境，并捕获 deployment evidence。

必须执行：

- 确认 issue 是从 `Released` 人工判定点进入 `Deployment`。
- 阅读项目部署规则：environment、rollout method、feature flags、migrations、smoke tests、rollback path。
- 验证要部署的 release artifact/version。
- 执行 deployment procedure；如果不允许直接部署，则准备精确 deployment action。
- 执行必要 smoke checks、health checks 或 post-deploy validation。
- 在 Workpad 记录 deployment evidence：environment、version/artifact、deployment URL 或 job ID、checks、timestamps、rollback notes。
- 只有 deployment 和 required checks 完成，才能移动到 `Deployed`。
- 如果部署暴露缺陷，带 actionable feedback 移回 `Development`。
- 如果被凭证、审批窗口、infra health 或外部系统阻塞，移动到 `Blocked`。

禁止：

- 不部署未批准或未知 artifact。
- 不跳过 required smoke checks。
- 不标记 `Done`；`Deployed` 是人工判定点。

退出状态：

- `Deployed`
- `Development`
- `Blocked`
```

#### Manual Gate

```md
## 人工判定点初始化

当前 issue 处于人工决策状态。

规则：

- 不修改代码、release artifact、deployment state 或 issue 内容。
- 除非 Linear comments 中有明确人工指令，或状态已经被人改到 active state，否则不得推进 issue。
- 如果明确人工反馈要求修改，必须确认反馈可执行，并且只有当反馈已记录在 Linear comments 或 Workpad 后，才能移动到 `Development`。
- 如果人类把 issue 标记为 `Done`，立即停止。
```

## Workpad 与 Comment 协议

`Workpad` 是 Linear issue 下面的一条普通 comment，使用固定标题：

```md
## Codex Workpad
```

它是 Agent 维护的任务执行日志、计划、验收标准、验证记录和 handoff source of truth。

每次启动或续跑时，Agent 必须：

```text
1. 读取 issue description
2. 读取所有 unresolved Linear issue comments，按时间升序
3. 找到最新且未 resolved 的 `## Codex Workpad`
4. 读取 Workpad 之后的新 comments，作为增量反馈
5. 读取 PR review comments、inline comments、CI/check failures
6. 将 actionable feedback 整理回唯一 Workpad
```

不能只看最近一条 comment，因为最近一条可能只是确认语，而真正的 bug 可能在更早的 QA comment 或 PR inline thread。

## Review Feedback 返工规则

任何回到 `Development` 的状态转移，必须带 actionable feedback。反馈来源可以是：

- PR inline comment
- PR review summary
- Linear issue comment
- CI/check failure
- Manual QA note
- Workpad 中未完成反馈项

推荐 Workpad 段落：

```md
### Review Feedback

- [ ] Source: PR #123 inline comment
      Finding: null state not handled in `syncRelease()`
      Required change: guard missing release id and show retryable error
      Validation: `npm test -- release-sync.test.ts`

- [ ] Source: Human Review / Linear comment
      Finding: deployed status can be marked before smoke test
      Required change: block transition until smoke test evidence exists
      Validation: attach smoke test output
```

处理完成后：

```md
- [x] Source: PR #123 inline comment
      Resolution: added guard and regression test
      Validation: `npm test -- release-sync.test.ts` passed
```

硬约束：

```text
Any transition back to Development must include actionable feedback in PR comments, Linear comments, or Codex Workpad before the state is changed.
```

## 多项目策略

多项目不要把所有背景塞进同一个巨大 prompt。推荐第一版：

```text
一个项目一份 WORKFLOW.<project>.md
一个项目一个 Symphony 进程
共享同一套 Agent Prompt
每个项目单独写 Project Prompt
Linear issue/comments/PR/Workpad 作为 Task Context 注入
```

示例：

```bash
symphony --port 4101 --logs-root ~/.local/state/symphony/project-a WORKFLOW.project-a.md
symphony --port 4102 --logs-root ~/.local/state/symphony/project-b WORKFLOW.project-b.md
```

每个项目至少隔离：

- `tracker.project_slug`
- `workspace.root`
- repo clone hook
- 测试/构建/发布/部署命令
- project prompt
- logs root 和 port

## 当前 Linear 同步结果

BOB team 已同步为以下节点：

```text
Backlog
Todo
Development
Code Review
Human Review
In Merge
Merged
Release Version
Released
Deployment
Deployed
Blocked
Done
Canceled
Duplicate
```

注意：`Duplicate` 是 Linear reserved state，GraphQL 不允许更新它的描述或 position；它仍可作为 `duplicate` terminal category 使用。
