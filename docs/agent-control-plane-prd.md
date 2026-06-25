# Agent Control Plane PRD

## 背景

当前 Symphony + Linear 方案已经验证了用 issue 状态驱动 agent 的基本可行性，但暴露出两个核心问题：

- Linear API 限制较多，不适合作为高频 agent runtime 状态库。
- Agent prompt 仍放在 GitHub/Markdown 中，修改、版本、发布和回滚都不够产品化。
- Agent 执行过程主要靠本地日志，缺少可视化的完整 conversation、tool call、token 和成本视图。

新的方案在运行时收敛成三个常驻进程：Plane、Agent Control Plane、Distributed Worker。默认执行链路不依赖付费 SaaS；所有需要额外购买额度、订阅或云端 license 的能力都不进入第一版必需路径。进度和工作量评估见 `docs/agent-control-plane-progress-assessment.md`，当前明确待办见 `docs/todo.md`。

```text
Plane
  任务、项目、状态、人类 review
      | webhook / Plane API
      v
Agent Control Plane
  prompt 平台、状态机、repo routing、并发、lease、重试、run events、审计、UI、唯一 DB 访问层
      | HTTPS Worker API
      v
Distributed Worker
  参考 Symphony，在目标 repo workspace 中启动 Codex CLI / codex app-server，执行任务并通过 Control Plane API 回写进度
```

## 已定决策

- Plane 必须 self-host，因为后续一定会二次开发。
- Plane 源码必须 fork 到自有 GitHub 并按自有部署链路发布；当前目标 fork 为 `https://github.com/michaelx1993/plane`，后续 Plane repo 字段、任务页面嵌入 agent 状态等二开都在该 fork 上推进。
- Plane 是人类任务平台，Control Plane 是 agent 调度平台。
- Agent 是 User 级资源；可编辑管理入口迁移到 Plane 的用户级 Agent Library 和项目级 Agent Bindings。Agent Control Plane 保存 Plane 同步来的 runtime projection，并承载 prompt release、run snapshot、worker 调度和权限 enforcement；详细设计见 `docs/plane-agent-role-management.md`。
- Phase 1 的代码执行任务必须绑定 Plane project 中已注册的 repository；布置任务时可以显式指定 Repository 和 Playbook node -> User Agent assignments，未显式分配的 node 使用 Project default agent 兜底，repo-less task 留到后续能力扩展。
- Phase 1 使用 Project default Worker Card 作为默认执行目标，Run 创建时可覆盖；Worker 复用真实宿主机环境，并为 development run 创建 per-run git worktree。
- Development node 成功后必须创建或更新 SCM Change Request；Agent Code Review 是自动节点，Human Review 是独立 gate；`request_changes` 自动打回 Development rework。
- Release 表示发布制品/镜像，Deployment 表示真正部署；Release 后必须回到 Human Gate，再由用户推进到 Deployment node。
- Playbook 创建 run 时复制为可编辑 Run Pipeline；gate / transition 支持运行中切换 `manual` / `auto`，用户可把 run 拖到任意 node，启动前检查 prerequisite。
- 每个 Project Workspace 有本地 Project Meta Git，用于 `status.md`、append-only `progress.md`、run summary 和 artifact index；Plane 是唯一编辑入口，Phase 2 再做 remote 定时同步。
- PostgreSQL 只允许 Agent Control Plane 访问；Plane 不直连 Control Plane DB，Distributed Worker 也不直连 DB。
- Distributed Worker 必须通过 Control Plane 暴露的内部 Worker API claim、heartbeat、写事件、写进度、完成或失败 run。
- Prompt 的用户可编辑主体验在 Plane；Prompt 保存后立即成为 latest，Prompt Binding 决定使用 `latest` 还是 `pinned`。Control Plane 保存可执行 projection、不可变 prompt release 和审计快照。不把 Langfuse 作为必需 prompt/trace 平台。
- Prompt Preview 是必需能力，Run create 和 Run detail 必须展示 assembled prompt、来源版本和 available secret keys；Secret 是 User 级密码本，Agent 使用时按 key 经 worker runtime 解析。
- 执行层默认参考 Symphony：Control Plane/Worker 组装任务上下文，在 repo workspace 中启动 Codex CLI / `codex app-server`，通过 Codex 事件流记录进度。
- OpenHands 只保留为可选 `ExecutionAdapter`，不作为默认执行器；没有 OpenHands Cloud API key 时不阻断本地开发或最终门禁。
- Langfuse 只保留为可选观测集成，默认关闭；没有 Langfuse Cloud 或 self-host 实例时不阻断本地开发或最终门禁。
- 付费 Cloud/SaaS 能力默认不纳入第一版必需架构；需要额外购买的 OpenHands Cloud、Langfuse Cloud、企业版 license 都不作为完成条件。
- Trace 不按多租户隐私产品设计，默认完整记录，方便个人调试。
- token project 下不再拆 crs/sub2/traffic 多个 project，统一用 repo 字段路由。
- repo 字段当前使用 Plane label `repo:<slug>`，正式设计应使用 Plane 二开字段。
- 单 run 估算成本当前可用 Plane label `cost:<usd>` 同步到 `tasks.estimated_cost_usd`；正式设计应使用 Plane 二开字段或 Control Plane 表单。
- 技术栈采用 TypeScript monorepo 起步，Node 24 作为本地和 CI 的默认运行时。
- 第一版先在当前 `aiworkspace` 仓库内沉淀 Control Plane 脚手架，随后按生产部署边界拆成 3 个自有源码仓库：`agent-control-plane`、`agent-worker`、`plane`。
- 所有运行组件都必须由我们自己持有源码、CI、镜像和部署脚本；不把不可控 SaaS 或只能拉官方镜像的闭源组件放进必需链路。

## 当前方案调整

2026-06-19 追加决策：

- 创业阶段优先省钱和交付价值，默认不采购新的付费执行/观测平台。
- Symphony 已验证的执行方式是启动 `codex app-server`，通过 `thread/start` 和 `turn/start` 驱动 Codex 在 workspace 中执行任务；Agent Control Plane 应复制这条路线。
- 第一版默认 execution profile 为 `codex-cli`，目标是用本机已有 Codex 能力完成真实任务。
- OpenHands Cloud、Langfuse Cloud、Enterprise license 等付费能力均不进入第一版必需路径。
- OpenHands adapter 和 Langfuse tracing 已有代码骨架，但只作为可选扩展保留。
- completion/cutover 脚本默认走 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli`；OpenHands/Langfuse 只在显式选择 legacy external profile 时强制。

## 与 Symphony 的边界

Symphony 继续作为执行模型参考，不作为最终平台底座。Worker 会吸收 Symphony 的核心执行链路：接单、准备 workspace、启动 `codex app-server`、通过 thread/turn 驱动 Codex、消费事件、写回状态。Agent Control Plane 则补上 Symphony 当前不适合承载的产品能力：

- Prompt 平台化：global / team / project / repo / role / agent / task context 动态装配，并支持审批、版本、回滚和审计。
- 运行可见性：Run Detail、Progress、Workpad、run events、lease、retry、成本、状态流转在 Web UI 可见。
- 状态机定制：自动状态和人工 gate 分离，支持打回 Development、短路 Done/Canceled、人工节点审计。
- 多项目多 repo 调度：按 team/project/repo/role/state/priority/budget/concurrency 派发。
- 低成本默认链路：默认使用本机 Codex 能力；OpenHands / Langfuse 只是可选增强。

## 目标通信架构

生产目标不是让 Worker 作为数据库客户端横向扩散，而是把 Control Plane 作为唯一控制面和唯一数据库访问层。

```text
Plane
  <-> Agent Control Plane Web/API
        <-> PostgreSQL
        <-> Distributed Workers
              -> Codex CLI / codex app-server
```

边界约束：

- Plane 与 Control Plane：通过 Plane webhook 和 Plane API 通信；Control Plane 保存 Plane work item 的必要镜像、URL、状态、label、comment feedback 和 sync cursor。
- Control Plane 与 PostgreSQL：Control Plane 独占读写数据库；所有状态机推进、claim、lease、prompt release、run event、Progress / Workpad、审计和告警重放都在 Control Plane 事务边界内完成。
- Worker 与 Control Plane：Worker 只持有 worker token，只能调用内部 Worker API；Worker 不持有 `DATABASE_URL`、不 import `@agent-control-plane/db`、不直接写 `tasks` / `runs` / `feedback_items` / `run_events`。
- Worker 与 Codex：Worker 在本地 workspace 启动 `codex exec --json` 或复用 `codex app-server`，把归一化后的事件、日志摘要、token/cost、完成状态和建议 next state 回传给 Control Plane。
- Plane writeback：由 Control Plane 统一执行或由 Control Plane 授权触发，避免多个 Worker 分散持有 Plane API key、重复写状态或重复留言。

内部 Worker API 第一版采用 HTTPS + bearer token，先用 pull 模式降低基础设施复杂度：

```text
POST /api/worker/v1/register
POST /api/worker/v1/runs/claim
POST /api/worker/v1/runs/:runId/heartbeat
POST /api/worker/v1/runs/:runId/events
POST /api/worker/v1/runs/:runId/progress
POST /api/worker/v1/runs/:runId/artifacts
POST /api/worker/v1/runs/:runId/complete
POST /api/worker/v1/runs/:runId/fail
```

`claim` 返回一次执行所需的完整快照：task、repository、rendered prompt、prompt release id、role、agent config、unresolved feedback、previous conversation ref、workspace strategy、Codex model/reasoning、lease TTL 和 allowed tools。Worker 不再自行查询数据库拼上下文。

当前代码仍保留本地 DB worker 闭环作为开发基线和 smoke harness。它是过渡实现，不是生产目标；后续开发应优先新增 `HttpControlPlaneClient`，把 DB claim/lifecycle 逻辑搬到 Control Plane Worker API 后面，再逐步让生产 Worker 移除直接 DB 依赖。

## 目标仓库拆分

生产部署按源码所有权和进程边界拆成 3 个仓库：

| 仓库                               | 负责进程                    | 包含源码                                                                                                                                   | 不包含                                     |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `michaelx1993/plane`               | Plane self-host             | Plane fork、Plane 二开字段/UI、Plane 自有镜像/Compose 发布脚本                                                                             | Agent runtime、Control Plane DB schema     |
| `michaelx1993/agent-control-plane` | Agent Control Plane Web/API | `apps/web`、`packages/core`、`packages/db`、`packages/plane` client、migrations、operator UI/API、Worker API server、cutover/audit scripts | 分布式 Worker 执行器实现、Plane 源码       |
| `michaelx1993/agent-worker`        | Distributed Worker          | Worker daemon、Codex CLI / app-server adapters、workspace manager、Control Plane HTTP client、worker smoke                                 | PostgreSQL 访问层、operator UI、Plane 源码 |

源码和部署约束：

- 这 3 个仓库都必须在我们的 GitHub 下，可审计、可 fork、可打 tag、可构建镜像。
- `agent-worker` 只能依赖 `agent-control-plane` 暴露的 Worker API contract；可通过 npm package 或 generated OpenAPI client 共享类型，但不能依赖 `packages/db`。
- `agent-control-plane` 是唯一持有 `DATABASE_URL` 的应用仓库。
- `plane` 是唯一承载 Plane 二开的仓库；repo 一等字段、agent 状态嵌入 work item 页面等需求都进入该 fork backlog。
- 当前 `aiworkspace` 在拆分前继续作为设计和集成孵化仓库；拆分完成后应只保留文档、编排脚本或归档，不能成为生产部署的隐性第四个运行仓库。

## 当前实现快照

截至 2026-06-19，当前仓库已经落地的是设计文档、monorepo 基础骨架、数据库首版迁移、Web/Worker 最小闭环、prompt release 最小闭环、Prompt Binding 审批/RBAC、workspace manager 本机目录版、OpenHands Cloud adapter 骨架、第一阶段 `codex-cli` adapter、adapter event 摘要同步、conversation ref 关联、trace ref 关联、Langfuse run-level instrumentation 骨架、Task Queue lease/retry 可视化、operator API token 保护、DB-backed operator user、operator signed session 最小登录态、基础运行监控 dashboard、基础告警、阈值 UI/API 动态配置、generic/slack/email webhook 告警通知、告警失败重放队列、secret validate gate、secret env file/rotation/expiry warning、secret rotation audit log、外部 secret command、12h/24h/7d run 趋势、Linear export -> Plane 迁移脚本、external preflight、completion gap report、cutover gate、completion audit，以及 P8 发布/部署/回滚/备份恢复最小脚本。下一步执行层目标是用真实 Plane task 验证 `codex-cli` adapter，并让默认完成证据落到 Codex run events、Progress/Workpad、Plane writeback、task-source、secret provider 和 provider audit：

- `docs/agent-control-plane-prd.md`
- `docs/agent-control-plane-erd.md`
- `docs/agent-control-plane-roadmap.md`
- `docs/agent-control-plane-status.md`
- `docs/plane-self-host-runbook.md`
- `docs/plane-capability-matrix.md`
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `apps/`
- `apps/web`
- `apps/worker`
- `packages/`
- `packages/core`
- `packages/db`

`packages/core` 已包含：

- Workflow state machine。
- 状态到 agent role 的路由。
- 允许状态转移规则。
- repo label 兜底解析，例如 `repo:crs-src`。
- task dispatch eligibility 判定。
- prompt component 装配顺序。
- Vitest 单元测试。

`packages/db` 已包含：

- Prisma 7 schema。
- PostgreSQL datasource 配置。
- ERD 首批核心表：team/project/repository/task/run/prompt/conversation/trace/audit。
- Migrations：`0001_initial`、`0002_role_status`、`0003_prompt_binding_approval`、`0004_legacy_enum_compat`、`0005_app_settings`、`0006_monitoring_alert_notifications`、`0007_task_estimated_cost`、`0008_agent_reasoning_high_default`。
- Seed SQL：`packages/db/prisma/seed.sql`。
- `prisma validate` 校验脚本。
- `pg` 查询层：数据库连接、事务、dispatch snapshot、dashboard summary、run claim/lifecycle 写入。
- prompt release 服务：按 task/repo/role/agent/team/project 读取 active binding，生成不可变 rendered prompt、content hash 和 release component 明细。
- prompt release 查询：可列出最近 release，并展示 task、repo、role、agent、hash 和组件数量。

`apps/web` 已包含：

- Next.js 16 控制台骨架。
- 中文 dashboard 首页。
- `/api/readiness`。
- `/api/auth/login`，支持 operator password 换 signed session cookie；登录时会 upsert/read `users` 表，并用 DB user id 写入 session。
- `/api/auth/logout`，支持清除 operator session cookie。
- `/api/auth/session`，支持读取当前 token/session 对应的 operator context。
- `/api/audit-events`，支持按 entity type、action、actor、时间窗口和 limit 查询审计事件，并返回 action/entity/actor 聚合摘要。
- `/api/users`，支持查询、创建和更新 DB-backed operator users；写操作会记录 `audit_events(action=user.upsert)`。
- `/api/dispatch/preview`。
- `/api/plane/webhook`，支持 Plane webhook 验签、issue sync 和 comment feedback 摄取。
- `/api/runs`，支持按 status、repository、role、task identifier 和 limit 查询 operator run 列表。
- `/api/runs/[runId]`，支持查看单次 run 的 task/repo/agent/prompt/events/conversation/trace 引用。
- `/api/prompt-releases`，支持查询最近 prompt release。
- `/api/prompt-releases/[releaseId]`，支持查看 rendered prompt 和 component 组成。
- `/api/prompt-components`，支持查询和创建 prompt component version。
- `/api/prompt-components/[componentId]`，支持查看 component 详情和历史版本。
- `/api/prompt-components/[componentId]/activate`，支持激活某个 prompt component version，并回写 active binding。
- `/api/prompt-components/[componentId]/archive`，支持归档 prompt component。
- `/api/prompt-components/diff`，支持对比两个 prompt component version。
- `/api/settings`，支持读取 team/project/repo/role/agent definition 设置快照和 prompt bindings。
- `/api/settings/repositories/[repositoryId]`，支持更新 repository slug/git/default branch/local path/status/description。
- `/api/settings/repositories` 和 `/api/settings/repositories/[repositoryId]/archive`，支持新增和归档 repository。
- `/api/settings/roles/[roleId]`，支持更新 role name/active states/next states/description。
- `/api/settings/roles` 和 `/api/settings/roles/[roleId]/archive`，支持新增和归档 role。
- `/api/settings/agent-definitions/[agentDefinitionId]`，支持更新 agent definition 模型、runtime、reasoning、工具和超时配置。
- 新建 agent definition 默认 `model=gpt-5.5`、`reasoningEffort=high`；seed 中内置 `gpt-5.5` agent 也会经 `0008_agent_reasoning_high_default` 迁移到 high reasoning。
- `/api/settings/agent-definitions` 和 `/api/settings/agent-definitions/[agentDefinitionId]/archive`，支持新增和归档 agent definition。
- `/api/prompt-bindings`，支持读取和创建 prompt binding；新建 binding 默认进入 `pending` 审批态。
- `/api/prompt-bindings/[bindingId]/status`，支持 `pending` / `active` / `disabled` / `rejected` 状态流转，并写入 audit event。
- `/runs`，支持 operator 按 status、repo、role、task identifier 和 limit 筛选 run 列表。
- `/runs/[runId]`，支持 operator 查看 run detail。
- `/prompt-releases/[releaseId]`，支持 operator 查看 prompt release detail。
- `/session`，支持查看当前 operator、认证方式、session 过期时间，并退出当前浏览器 session。
- `/users`，支持查看、创建和更新 DB-backed operator users。
- `/audit`，支持查看审计总量、唯一 actor、时间范围、Top action/entity/actor 和最近事件列表。
- `/prompt-components` 和 `/prompt-components/[componentId]`，支持 Prompt Manager 最小管理 UI。
- `/settings`，支持 Project Settings 和 Prompt Binding 最小管理 UI。
- `/tasks` 和 `/tasks/[taskId]`，支持查看任务队列、人工 gate、latest/active run、attempt、lease owner、lease expiry、heartbeat、retryable、retry-after 和任务级 Progress / Workpad；`POST /api/tasks/[taskId]/feedback` 支持摄取 PR review feedback；任务队列支持 lease/retry 深度筛选；worker 支持按 repo/role 配置并发上限，并支持单 run 估算成本门禁。
- `/api/monitoring/thresholds`，支持读取和更新监控告警阈值，更新写入 `app_settings` 并记录 audit event。
- Dashboard/readiness 可读取 PostgreSQL summary；首页 `运行监控` 展示 agent queue、active runs、human gates、blocked/stalled、retry backlog、24h success rate、failed runs、token/cost、基础告警、当前告警阈值和 12h/24h/7d 可切换趋势图。告警阈值优先读取 `app_settings`，缺省时回退到 `MONITORING_*` 环境变量。
- worker 配置 `MONITORING_ALERT_WEBHOOK_URL` 后会发送 warning/critical monitoring alerts；`MONITORING_ALERT_MIN_INTERVAL_MS` 控制相同告警指纹的重复发送间隔；`MONITORING_ALERT_FORMAT=slack` 时输出 Slack Block Kit payload，`MONITORING_ALERT_FORMAT=email` 时输出 subject/text/html 邮件 payload，否则输出通用 JSON payload。发送失败会 upsert 到 `monitoring_alert_notifications`，后续轮询优先重放到期记录。
- `ACP_OPERATOR_API_TOKEN` 可选保护 operator APIs；配置后除 `/api/readiness`、`/api/plane/webhook`、`/api/auth/login` 和 `/api/auth/logout` 外，所有 `/api/*` 请求必须提供 `Authorization: Bearer <token>`、`x-acp-operator-token` 或有效 `acp_operator_session` signed cookie。`CONTROL_PLANE_API_TOKEN` 保留为旧变量 fallback。
- `/login` 和 `POST /api/auth/login` 使用 `ACP_OPERATOR_LOGIN_PASSWORD` 创建 `acp_operator_session` signed HttpOnly cookie；登录会确保 `users(external_provider=local, external_user_id=<operator name>)` 存在，并使用 DB user id 作为 session/audit actor id；`ACP_OPERATOR_SESSION_SECRET` 用于 HMAC 签名，`ACP_OPERATOR_SESSION_TTL_SECONDS` 控制过期时间。
- Web 单元测试。

`apps/worker` 已包含：

- Node worker skeleton。
- PostgreSQL dispatch input 查询。
- `runs` claimed lease 写入。
- `run_events` claimed 事件写入。
- active lease 防重复认领。
- mock 生命周期写入 `running`、`heartbeat`、`succeeded`。
- Development 默认推进到 `Code Review`，Code Review 默认推进到 `Human Review`；本地 `pnpm worker:workflow-smoke` 已验证自动 agent run 与人工 gate 串联后可完整进入 `Done`。
- Worker 会把 `Agent Status: Running / Completed / Failed` 写入任务级 `agent_progress` workpad，operator 可在任务详情直接看到 agent 接单、完成和失败摘要。
- worker 完成 run 后可回写 Plane work item state 和 summary comment。
- lease TTL / worker id 配置。
- `WORKER_RUN_LOOP=true` 时支持长运行轮询；adapter 执行期间按 `WORKER_LEASE_RENEWAL_INTERVAL_MS` heartbeat 并续租；CLI 支持 `SIGINT` / `SIGTERM` graceful shutdown。
- `WORKER_EXECUTION_ADAPTER` 配置，默认 `mock-openhands`。
- `ExecutionAdapter` 抽象和 mock OpenHands adapter。
- `openhands-cloud` adapter，可调用 OpenHands Cloud V1 REST API。
- OpenHands terminal status 已有本地 completion/retry/block 映射，覆盖常见大小写/同义状态：`finished/completed/succeeded` 成功，等待确认/用户输入和 stuck/blocked/paused 类状态进入 non-retryable failed，sandbox error/missing/lost/unavailable/terminated 与 execution error/failed/crashed/timeout 类状态进入 retryable failed，cancelled/aborted/stopped 进入 non-retryable failed；adapter throw、API error 和 timeout 会写入 `openhands.adapter_error`，并标记为 retryable failed。
- `MONITORING_ALERT_WEBHOOK_URL` 存在时，worker 每轮运行后会读取 summary，将 active alerts POST 到 webhook；`MONITORING_ALERT_MIN_INTERVAL_MS` 用于同一 fingerprint 节流；`MONITORING_ALERT_FORMAT` 支持 `generic` / `slack` / `email`；失败 payload 会进入 `monitoring_alert_notifications`，由 `MONITORING_ALERT_REPLAY_LIMIT` 和 `MONITORING_ALERT_RETRY_BACKOFF_MS` 控制每轮重放数量和失败后退避。
- worker 执行前会准备 workspace：默认优先使用 repository `local_path`，否则在 `WORKER_WORKSPACE_ROOT` 下创建 ephemeral workspace；设置 `WORKER_WORKSPACE_STRATEGY=git-worktree` 且 repository 有 `local_path` 时，会为每个 run 创建隔离 git worktree；准备完成后写入 `workspaces` 和 `run_events(workspace.ready)`。
- `pnpm workspace:cleanup` 可清理已完成 run 的过期 ephemeral / git-worktree workspace，默认 dry-run；设置 `WORKSPACE_CLEANUP_APPLY=true` 后，git-worktree 优先走 `git worktree remove --force` / `git worktree prune`，失败时 fallback 到目录删除，并写入 `workspace.cleaned` 事件；`pnpm workspace:cleanup-smoke` 已覆盖临时库 dry-run/apply 合约。
- run 执行前生成并绑定 `prompt_release_id`。
- 将 rendered prompt 和 prompt release id 注入 execution adapter。
- adapter 可返回轻量事件摘要，worker 会写入 `run_events`；mock adapter 当前写入 agent message / tool call / shell 三类事件，OpenHands Cloud adapter 当前会从 conversation payload 的 `events` / `event_log` / `eventLog` / `messages` 及其常见嵌套列表容器中提取 agent message、tool call、file operation、shell、LLM generation 和 status 摘要；file operation 会优先识别 read/write/edit/patch/file path/diff 类事件，避免文件读写被淹没在 generic tool call 里；如果 payload 暴露同源 event log URL/URI，会额外拉取 event log 并优先用 event log 摘要；如果 payload 没暴露 URL，可用 `OPENHANDS_EVENT_LOG_PATH_TEMPLATE` 配置同源 event API fallback；拉取失败时写 warning event 并回退到 conversation payload 摘要。本地摘要写入前会对常见 API key、token、secret、password、Bearer token 和 `sk-*` key 做最小脱敏。
- adapter 返回 conversation ref 时写入 `conversation_refs`。
- adapter 返回 trace refs 时写入 `trace_refs`，并汇总 token/cost 到 `runs`；OpenHands Cloud adapter 已可从 conversation payload、同源 event log payload、`trace_refs` / `traceRefs` / `traces` 和 event/message payload trace 字段提取外部 trace ref。
- 可选启用 Langfuse SDK tracing：`LANGFUSE_ENABLED=true` 且 credentials 存在时，worker 会启动 `NodeSDK + LangfuseSpanProcessor`，为每次 run 创建 `agent-run` observation。
- Langfuse tracing 会写回 `trace_refs(provider=langfuse)`；配置 `LANGFUSE_PROJECT_ID` 后可生成 Langfuse trace UI URL；run-level observation input 已包含最终 rendered prompt，output 已包含 run status / summary / failure reason。
- `pnpm worker` 单次运行入口。
- `pnpm plane:sync` 会拉取 Plane work items 和 comments；comments 会幂等写入 `feedback_items(source=plane_comment)`，作为 webhook 不完整时的 polling fallback；Plane polling 默认对 429、5xx、408 和网络类失败重试 3 次、基础延迟 1000ms，可用 `PLANE_SYNC_RETRY_ATTEMPTS` / `PLANE_SYNC_RETRY_DELAY_MS` 覆盖；Plane client 会把 429 等 API error 结构化，并从 `Retry-After` / `X-RateLimit-Reset` 推导 `retryAfterMs` 供 sync 优先退避，401/403/404 等非重试型 4xx 不会被盲重试；单个 work item comment 拉取最终失败时会记录 `commentFetchWarnings` 并继续同步其他 task/comment；配置 `MONITORING_ALERT_WEBHOOK_URL` 后，`commentFetchWarnings` 或全局 sync failure 会发送 Plane sync warning/critical webhook；完全成功后会把最新 task/comment cursor 写入 `app_settings(plane.sync_cursor.<projectSlug>)`，下一轮只 upsert cursor 之后变更的 task/comment。
- Worker 单元测试。

当前仍未验收或尚未产品化的模块：

- 真实 `codex-cli` / `codex-app-server` Codex Worker run 已在本机临时 DB / git-worktree smoke 中跑通；尚未在真实 Plane task 上完成端到端验收。
- Codex run events 到 `run_events` / Progress / Workpad / Run Detail 的生产级映射仍需用真实输出校准。
- 正式生产数据库迁移部署。
- Plane polling 已完成本地 cursor 级增量 upsert、全局 API retry、comment polling 部分失败降级、Plane sync warning/failure webhook 和可选服务端 `updated_after` 查询；真实 Plane 版本的 `updated_after` 能力仍待验证。
- Workspace manager 本机目录版已落地；adapter event stream 摘要同步已落地；OpenHands Cloud conversation payload 事件摘要提取、同源 event log URL 拉取和可配置 event API path fallback 已落地；真实 OpenHands 细粒度 event API payload 属于 optional/legacy profile 校准项。
- Worker 长运行 loop、lease 自动续租和 lease 过期后重新派发已落地；本地 `pnpm worker:lease-smoke` 已验证延迟 mock adapter 执行期间会多次 heartbeat/续租，`pnpm worker:crash-smoke` 已验证过期 running run 会先标记 stalled，再以 attempt=2 重新认领；真实 Codex 长任务、workspace 残留恢复和 Plane writeback 仍需验收。
- P7 agent pool、repo/role/agent 并发门禁、单 run 估算成本门禁、预算超限自动 Blocked、持久化 dispatch budget policy、可配置 queue priority policy、priority aging、repo fair queue 和 weighted priority 已落地；真实多 worker/多 repo 长时间公平性调优仍需生产数据。
- OpenHands/Langfuse 真实端到端 smoke 仅作为 optional/legacy profile 验收项，不阻断第一版 Codex-first 完成。
- OpenHands 内部逐 LLM call prompt/output 与 Langfuse trace 的深度关联只在未来启用对应可选集成时校准；当前默认以 Control Plane run-level rendered prompt、最终结果 output、Codex/OpenHands adapter 事件摘要和本地 trace refs 记录为准。
- 如果 OpenHands conversation payload 已返回 `trace_refs` / `traceRefs` / `traces`，或在 event/message payload 中返回 `trace_id` / `traceId` / `langfuse_trace_id` / `langfuseTraceId`，adapter 会把这些外部 trace 引用写入本地 `trace_refs`，并尽量保留 generation/model/token/cost/latency/UI URL；但这仍不代表已经能采集 OpenHands 内部每次 LLM call 的完整 prompt/output。
- Docker Compose / CI release gate / 镜像发布 / Compose 部署 / 应用镜像回滚 / 数据库备份恢复 / 基础运行监控 dashboard / 基础告警 / 阈值 UI/API 动态配置 / generic/slack/email webhook 告警通知 / 告警失败重放队列 / secret validate gate / secret env file/rotation/expiry warning 最小链路 / secret rotation audit log / 外部 secret command 接入 / secret provider smoke / production smoke harness / 可选外部依赖只读探针 / Linear export -> Plane 迁移脚本 / 12h/24h/7d run 趋势已完成；真实端到端外部 smoke 未完成。
- provider-side audit file/command smoke 已完成；真实供应商账号/API 下拉取审计事件并跑通 smoke 仍未验收。

Plane P0.5 当前状态：

- `michaelx1993/plane` fork 已存在。
- Plane self-host runbook 已沉淀。
- Plane API/webhook capability matrix 已沉淀。
- 本地 Plane self-host 已启动：`http://127.0.0.1:3200`。
- PAT/API smoke test 已通过。
- Webhook smoke test 已通过。
- repo custom property 在当前 Plane v1.3.1 Community self-host 不可用。
- `repo:<slug>` label fallback 已验证，并已作为当前 P1 同步路径。

这些未落地项仍以 Roadmap 为准推进，不应在文档中视为已完成能力。

本轮文档同步口径：

- `docs/agent-control-plane-status.md` 是当前“已完成 / 未验收 / 下一步”的快速入口；PRD、ERD、Roadmap 仍保留完整设计细节。
- 运行监控阈值已经从纯环境变量升级为“DB 动态配置优先、环境变量兜底”。`app_settings` 是当前运行期配置事实源。
- `/settings` Monitoring Thresholds 表单和 `GET/PUT /api/monitoring/thresholds` 是当前阈值管理入口；更新动作会写入 audit event。
- `/audit` 是当前审计查询入口；`/users` 是当前 DB-backed operator user 管理入口；`/session` 是当前浏览器 session 管理入口。
- `pnpm smoke:production` 是当前部署后最小 smoke harness，默认只读检查 readiness、auth session、runs、tasks、audit events 和 users；readiness 默认要求 `database.connected=true`；写入口 smoke 必须显式打开 `ACP_SMOKE_ENABLE_USER_WRITE=true`；外部依赖只读探针必须显式打开 `ACP_SMOKE_EXTERNAL=true`；脚本会先加载 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND` 再执行 secret validation，支持最终 cutover env 文件直接驱动 smoke。
- `pnpm plane:human-gate-writeback-smoke` 是当前 Web API 级 human gate writeback contract 入口；它用 mock DB/Plane SDK 覆盖 `transition`、`rework` 和 `feedback(requestRework=true)` 三条路径，验证 API 会调用 Plane state/comment writeback helper，并验证 feedback-only comment 不触发 Plane 写入。它不调用真实 Plane API。
- `pnpm plane:writeback-smoke` 是当前 Plane writeback smoke 入口；默认只验证 state 可读取，设置 `PLANE_WRITEBACK_SMOKE_VERIFY_COMMENTS=true` 和 `PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID` 可只读验证 comments list API；设置 `PLANE_WRITEBACK_SMOKE_APPLY=true` 和 `PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID` 后才真实 PATCH work item state、写 comment，并回读验证 state/comment。
- `pnpm openhands:smoke` 是当前 OpenHands conversation smoke 入口；默认只读 probe，设置 `OPENHANDS_SMOKE_CREATE_CONVERSATION=true` 后才真实创建 conversation，可选 `OPENHANDS_SMOKE_WAIT_READY=true` 等待 ready；设置 `OPENHANDS_SMOKE_PAYLOAD_FILE=/secure/raw-openhands-payload.json` 后会回读 conversation 和 event log，写出权限为 `0600` 的 payload contract JSON，便于真实 API 结构校准。
- `pnpm openhands:payload-contract` 是当前 OpenHands payload 离线契约校验入口；默认使用 `apps/worker/fixtures/openhands-payload-contract.sample.json`，也可通过 `OPENHANDS_PAYLOAD_CONTRACT_FILE=/secure/raw-openhands-payload.json` 输入 `openhands:smoke` 保存的真实 payload，验证 terminal decision、event summary 类型、trace ref 提取和 secret 脱敏。它不调用 OpenHands API，不替代真实 conversation smoke。
- `pnpm openhands:adapter-smoke` 是当前 OpenHands Cloud adapter 级 smoke 入口；直接执行 worker `OpenHandsCloudAdapter.execute()`，验证 terminal status、conversation ref、event summary 和 role next state，不写数据库。
- `pnpm openhands:db-smoke` 是当前数据库驱动 OpenHands run smoke 入口；会 upsert 一条 Development smoke task，执行一次 worker，并回查 prompt release、conversation ref、workspace event、OpenHands status event 和 next state；stdout 会输出 `conversation_id`、OpenHands `ui_url`、`prompt_release_id`、`trace_refs` 和首个 `trace_ui_url`，便于真实 cutover evidence 归档。建议绑定专用 smoke project；临时库可设置 `OPENHANDS_DB_SMOKE_ISOLATE_PROJECT=true`，将同项目其它自动任务退回 `Backlog`，避免一轮 worker 同时 claim 多条任务污染 smoke 结果。
- `pnpm worker:lease-smoke` 是当前本地 worker lease renewal smoke 入口；默认创建临时数据库，使用延迟 `mock-openhands` 验证长任务期间多次 heartbeat/lease renewal，不等于真实 Codex 长任务验收。
- `pnpm worker:crash-smoke` 是当前本地 worker crash recovery smoke 入口；默认创建临时数据库，插入过期 running run，验证旧 run 被标记为 stalled、同一任务以 attempt=2 被重新认领并推进到 Code Review，不等于真实 Codex 进程崩溃和 workspace 清理验收。
- `pnpm worker:budget-smoke` 是当前本地 worker budget gate smoke 入口；默认创建临时数据库，插入一条超过 `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` 的 Development task，验证 worker 不 claim、不创建 run，而是自动切到 `Blocked` 并写入 `agent_progress` 说明预算超限原因。
- `pnpm worker:fairness-smoke` 是当前本地多 repo 公平队列 smoke 入口；默认创建临时数据库，插入两个 repo 的 Development tasks，验证 `repo_fair` 策略按 repo 轮转，且 dispatch claim 顺序跟随轮转。
- `pnpm worker:workspace-smoke` 是当前本地 git-worktree workspace 准备 smoke 入口；默认创建临时数据库和临时 git repository，验证 worker run 会创建 per-run git worktree、写入 `workspace.ready`，并把 workspace path/strategy 注入 adapter。
- `pnpm worker:workflow-smoke` 是当前本地 workflow 全链路 smoke 入口；默认创建临时数据库，用 `mock-openhands` 验证 `Development -> Code Review -> Human Review -> In Merge -> Merged -> Ready for Release -> In Release -> Released -> Ready for Deployment -> Deployment -> Deployed -> Done`，并要求每个自动 run 至少写入 Running / Completed 两条 `agent_progress`；它不等于真实 Plane UI 人工操作、真实 Plane writeback 或完整 cutover 验收。
- `pnpm langfuse:smoke` 是当前 Langfuse trace smoke 入口；默认复用 worker SDK instrumentation 写入一条 smoke trace，`LANGFUSE_SMOKE_DRY_RUN=true` 只用于本地配置验证，不可作为 cutover 真实验收。
- `pnpm external:preflight` 是真实 cutover smoke 前的配置预检入口，会先安全加载 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND`，再读取 `ACP_COMPLETION_EXECUTION_PROFILE`、`ACP_EXTERNAL_PREFLIGHT_ID` 和 `ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING`。默认 `codex-cli` profile 检查 production smoke、Plane writeback、Codex adapter / Worker run evidence、task-source、secret provider、provider audit、旧 poller 冻结和 Linear 归档所需变量与关键开关；OpenHands conversation / DB run 和 Langfuse trace 只在 legacy external profile 中强制。它不打印 secret 值，也不替代真实 smoke，并会拒绝最终 env 模板残留的 `<...>`、`owner/repo`、`example.com` 和 `YYYY-MM-DD` 占位符，以及外部 smoke URL 指向 `localhost`、`127/8`、`0.0.0.0` 或 `::1`。设置 `ACP_EXTERNAL_PREFLIGHT_REPORT_FILE` 后，JSON report 的 `nextCommands` 会包含生成最终 env 模板或对既有 env 执行 append-missing、执行 `completion:gap` 生成 action plan、分项 smoke 和最终 `completion:final` 的非敏感命令；若已显式设置 `ACP_SECRET_ENV_FILE`，其中 external preflight/gap/final 命令会沿用该路径。设置 `ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT=true` 后，`pnpm cutover:check` 会把 `preflight_id` / `ready_count` / `missing_count` 写入 cutover report；在 `completion:final` 调用链里，还会要求 report 里的 `preflight_id` 匹配本次 `ACP_EXTERNAL_PREFLIGHT_ID`。
- `pnpm completion:doctor` 是真实 cutover 前的非敏感诊断入口，会包装 `completion:gap`，输出 secret env 文件状态、manual/auto-bound 缺口计数、scope 级 `status/ready/missing` 摘要、manual `placeholder` / `not_true` 分组、关键 URL 变量是否缺失/占位/已设置、OpenHands/Langfuse 在默认 `codex-cli` profile 下是否为 `optional_*` 状态、cutover 人工确认开关是否为 `true`、本机 Plane/Control Plane/OpenHands/Langfuse 只读探针结果、是否需要补 manual 变量/替换占位符/确认 cutover 开关/启动本机 Control Plane 的 hints，以及下一步 preflight/gap/final、查看 action plan/checklist/matrix 和逐条展开 missing 的命令；它只打印变量名和状态，不打印 secret 值，不修改外部系统，也不替代最终 `completion:final` 证据。
- `pnpm completion:gap` 是当前环境缺口报告入口，会以 allow-missing 模式执行 `external:preflight` 并写出 `0600` JSON 报告，便于归档当前缺口；若未显式设置 `ACP_SECRET_ENV_FILE` 且默认 `.secrets/completion-final.env` 存在，它会自动加载该文件用于诊断缺口，避免 operator 忘记带 env 后看到全量空缺；可用 `ACP_COMPLETION_GAP_USE_DEFAULT_ENV_FILE=false` 关闭，或用 `ACP_COMPLETION_GAP_DEFAULT_ENV_FILE` 改默认路径。终端会输出当前 `ACP_SECRET_ENV_FILE` 状态、默认 env 文件是否存在、`default_final_env_file_hint`、ready/missing 总数、占位符/缺变量/不安全 URL 计数、缺口变量名清单、`completion_final_auto_bound_missing_variables`、`manual_missing_variables`、manual 变量按 `missing_required` / `placeholder` / `not_true` / `unsafe_url` / `other` 拆分的清单、每个 scope 的 `scope=<name>;status=<status>;ready=<n>;missing=<n>` 摘要，以及生成 `.secrets/completion-final.env` 或对既有 env 执行 append-missing、带 `ACP_SECRET_ENV_FILE` 执行 `external:preflight`、复跑 `completion:gap` 和执行 `pnpm completion:final` 的下一步命令；若当前已显式设置 `ACP_SECRET_ENV_FILE`，终端、JSON report 和 action plan 中的 external preflight/复跑/最终命令会沿用该路径；JSON report 会保留 `external:preflight` 原有分项 smoke nextCommands，并只规范其中的 external preflight/gap/final env 路径。默认还会写出权限为 `0600` 的 `reports/<gap-id>.variables.txt`、`reports/<gap-id>.variables.tsv`、`reports/<gap-id>.checklist.md` 和 `reports/<gap-id>.action-plan.md`，并在终端输出 JSON report、variables、matrix、checklist 和 action plan 的 `600` mode；JSON report 的 `generatedArtifacts` 也会写入 artifact 路径、缺口变量列表、auto-bound/manual 变量计数和 manual reason 分组，TSV 字段为 `variable / scopes / reason_types / missing_count`，Markdown checklist 按 scope 生成可勾选缺口项，并单列 `completion:final` 会自动绑定的 final run id、external preflight id、cutover report id、cutover report path，以及 final wrapper 会强制默认的 Codex-first 最终 smoke / adapter / writeback 开关，并把 OpenHands/Langfuse 仅作为 legacy optional 开关列出；manual 变量 reason 分组只保留操作者必须真实填写的变量；action plan 按 operator sequence、auto-bound 变量、manual 变量和 scope 优先级组织下一步执行顺序，可用 `ACP_COMPLETION_GAP_VARIABLES_FILE` / `ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE` / `ACP_COMPLETION_GAP_CHECKLIST_FILE` / `ACP_COMPLETION_GAP_ACTION_PLAN_FILE` 改路径；它只报告缺口，不是完成证据。
- `pnpm completion:final-env-template` 当前默认生成 `codex-cli` profile dotenv 模板，会输出到 stdout 或写入权限为 `0600` 的 env 文件；已有 env 文件默认仍拒绝覆盖，可用 `ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true` 只追加模板中缺失的变量且不覆盖已有值。模板会包含旧 Linear/Symphony poller 和 Linear archive 两个人工 cutover gate，默认值为 `false`，必须在取得真实证据后显式改为 `true`。OpenHands/Langfuse 配置只保留为 legacy profile 注释。最终门禁默认以 Codex run events / Progress / Workpad 为核心 evidence。
- `pnpm linear:migrate-smoke` 是 Linear export -> Plane import 的本地合约验证入口，使用 mock Plane 覆盖 dry-run/apply、终态跳过、state/label/priority 映射、缺失 label 计数，以及迁移 description 中的原 Linear identifier/URL provenance；真实 cutover 仍必须在真实 Plane project 上执行迁移并留存 evidence。
- `pnpm task-source:local-smoke` 是任务来源审计的本地合约验证入口，创建临时数据库和 Plane-routed 样本，默认 `codex-cli` profile 要求 Plane URL、repo routing、Control Plane run、Codex run events、Progress / Workpad、prompt release 和 workspace evidence 同时存在；真实 cutover 仍必须在真实 Plane/Control Plane 样本上执行 `pnpm task-source:smoke`。
- `pnpm completion:audit` 会拒绝权限不是 `0600` / `0400` 的 cutover report，避免最终完成审计读取过宽权限的证据文件；若当前环境设置了 `ACP_CUTOVER_REPORT_ID`，审计会要求 cutover report 中的 `reportId` 与其一致。默认 `codex-cli` profile 审计 Codex adapter / Worker run、Control Plane run events、Progress / Workpad、Plane writeback、production smoke、task-source、secret provider、provider audit、旧 poller 冻结、Linear 归档和 worker crash/budget/workflow evidence；OpenHands payload/adapter/DB run 和 Langfuse trace 只在 legacy external profile 下强制。Plane writeback evidence 必须包含 `work_item_id`、`state`、`comment=created` 和 `verified=true`，避免只改状态不留评论也被算作完成；也会拒绝模板占位 evidence，覆盖 URL 和 run id、task id、provider、preflight id、日期等标量字段，避免把未替换模板样例当成真实 cutover 证据。若当前环境设置了 `ACP_EXTERNAL_PREFLIGHT_ID`，审计会要求 cutover report 中的 external preflight evidence 使用同一个 `preflight_id`，避免把其它 run 的预检结果混入当前完成声明。provider audit 的 `newest_event_at`、旧 poller 冻结证据日期和 Linear 归档证据日期还必须落在 `ACP_COMPLETION_AUDIT_MAX_REPORT_AGE_HOURS` 窗口内，避免 fresh report 夹带陈旧 evidence。
- `pnpm completion:final` 当前实现已 profile-aware：默认 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 且 `WORKER_EXECUTION_ADAPTER=codex-cli`；显式设置 `WORKER_EXECUTION_ADAPTER=codex-app-server` 时会走 Symphony-style app-server adapter smoke。dry-run 和执行前提示会输出生成最终 env 模板或 append-missing 的下一步命令；只在显式选择 legacy external profile 时才要求 OpenHands/Langfuse evidence。
- `pnpm cutover:check` 可通过 `ACP_CUTOVER_RUN_PRODUCTION_SMOKE=true` 在切换前复跑 production smoke，可通过 `ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE=true` / `ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE=true` / `ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE=true` / `ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE=true` / `ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE=true` / `ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE=true` / `ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE=true` 自动执行 Plane writeback、任务来源审计、本地 worker 崩溃恢复、预算门禁、完整 workflow smoke、secret provider smoke 和 provider audit smoke。OpenHands conversation/adapter/DB run 与 Langfuse smoke 开关只属于 legacy/optional profile。手工 evidence 也可放在 `ACP_SECRET_ENV_FILE` 中，脚本加载后会绑定到 cutover report；设置 `ACP_CUTOVER_REPORT_FILE` 后会写出机器可读 JSON 报告，记录 `reportId`、`completionFinalRunId`、readiness、errors、warnings、smoke 开关和 evidence 摘要，包括 external preflight `preflight_id` / `ready_count` / `missing_count`、secret provider 变量数量和 provider audit 事件数量；已存在的 report 默认不会被覆盖，动态来自 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND` 的 report path 也会在 secret 加载后检查，只有显式设置 `ACP_CUTOVER_REPORT_OVERWRITE=true` 才允许替换；`ACP_CUTOVER_REPORT_ID` 和 `ACP_EXTERNAL_PREFLIGHT_ID` 可把 report / preflight 绑定到外部变更单、final run 或 cutover issue；`pnpm completion:audit` 可读取该 report，阻断缺真实 Codex-first 证据、模板样例 evidence 或误用本地 rehearsal 证据的完成声明；`pnpm cutover:rehearsal` 已默认用本地 mock 外部服务、临时 secret provider dotenv 和临时数据库验证 gate 编排，并会校验 cutover JSON report；该 secret provider smoke 只验证脚本契约，不代表真实供应商 provider；`completion:audit` 必须拒绝 rehearsal report；这些仍不替代人工抽查完整代码变更质量，也不替代 Linear/Symphony -> Plane/Control Plane 的真实完整 cutover rehearsal。
- `pnpm cutover:report-smoke` 会验证 production smoke 命令失败时 `cutover:check` 必须退出失败、写入 `smoke: production smoke failed`，并保持 `productionSmoke=not-run`，避免部分失败输出被包装成可用 evidence；同时验证 `smoke:production` 会先加载 `ACP_SECRET_ENV_FILE` 再执行 secret validation。
- 2026-06-20 已通过 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=false pnpm completion:local-smoke` 本地聚合门禁，覆盖 `git diff --check`、脚本语法检查、`doc-script-parity-smoke`、`pnpm check`、`pnpm db:validate`、`pnpm secrets:validate`、Core/DB/Plane build、`operator:query-smoke`、`linear:migrate-smoke`、`plane:human-gate-writeback-smoke`、`worker:codex-plane-smoke` 默认安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server pnpm worker:codex-plane-smoke` 安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm worker:codex-plane-smoke` 安全 skip、`openhands:payload-contract`、`task-source:local-smoke`、`cutover:report-smoke`、`external:preflight-smoke`、`completion:doctor-smoke`、`completion:gap-smoke`、`completion:final-env-template-smoke`、`completion:audit-smoke`、`completion:final-smoke`、`completion:local-web-build-smoke`；`ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=auto` 时无 Next dev lock 会自动纳入 Web production build，有 dev lock 时会跳过并输出持锁 PID；Web production build 遇到瞬时 Next 并发 build lock 时默认重试 1 次，并已由 `completion:local-web-build-smoke` 覆盖 retry / 非 lock 不重试 / 非法参数拒绝。该结果只证明本地 harness 完整，不等于真实外部 cutover 完成。
- 任务来源切换的验收口径已明确并有自动 smoke：旧 Linear/Symphony poller 必须停止或只读；新任务先在 Plane 创建，再同步为 Control Plane `tasks`；非终态自动派发任务的 `tasks.url` 应指向 Plane work item，且必须完成 repo routing；执行证据默认来自 Control Plane run、Codex run events、Progress / Workpad、prompt release 和 workspace；Plane state/comment writeback 必须可回读。`pnpm task-source:smoke` 会阻断 Linear URL、缺 Plane URL、缺 repo routing；当前脚本里的 conversation/trace 要求属于 legacy external profile，默认 `codex-cli` profile 需要改为 run/events/progress/workpad 证据。
- 最终完成审计不会只检查 task-source 证据是否“存在”。默认 `codex-cli` profile 下，`task_source_evidence` 必须证明每一条 checked 任务都有 Plane URL、repo routing、Control Plane run、Codex run events、Progress / Workpad、prompt release 和 workspace 覆盖，且 `linear_urls=0`；OpenHands conversation 和 Langfuse trace 只作为可选外部证据。
- `pnpm secrets:provider-smoke` 可验证 `ACP_SECRET_COMMAND` 真实输出非空、dotenv-compatible，并可通过 production secret gate；`ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE=true` 会把该检查纳入 cutover gate。
- `pnpm secrets:provider-audit-smoke` 可验证 provider 导出的 JSONL 审计文件，或执行 `SECRET_PROVIDER_AUDIT_COMMAND` 拉取 JSONL，确认其中包含轮换事件且不泄露当前 secret 值；`ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE=true` 会把该检查纳入 cutover gate。当前通用 file/command harness 已完成，但不等于已经在真实供应商账号/API 下验收。
- `pnpm linear:migrate` 是当前 Linear/Symphony 迁移最小入口；默认 dry-run，显式设置 `LINEAR_MIGRATION_APPLY=true` 后才写入 Plane。
- 旧实验库兼容由 `0004_legacy_enum_compat` 覆盖，重点处理历史 Prisma enum 中缺失 `Duplicate` / `stalled` 的问题。
- `Duplicate` 已按终态处理，queue/claim/summary/snapshot 查询不应再把它视为 active task。
- 这不代表 P8 完成。真实 Codex Worker run、真实 Plane writeback smoke、真实生产 smoke、真实 task-source cutover 样本、真实 secret provider command、真实供应商账号/API 审计 smoke 和真实完整 cutover rehearsal 仍是剩余主线；OpenHands/Langfuse 仅是 optional/legacy profile。当前已具备多种 smoke harness、external preflight、本地 cutover rehearsal harness 和 completion audit，但尚未用真实 cutover 流程生成可通过默认 `codex-cli` 审计的 report。

## 产品目标

1. 用 Plane 替代 Linear 承载任务和人工流程。
2. 用 Agent Control Plane 替代把 agent runtime 状态塞进任务系统。
3. 用平台化 prompt 管理替代 GitHub 私有 prompt 仓库。
4. 用 Control Plane run events + Progress + Workpad + audit 打开 agent 执行黑盒，OpenHands / Langfuse 仅作为可选增强。
5. 支持一个项目下多个 repo，分发任务时必须显式指定 repo。

## 非目标

- 第一阶段不重写 Plane 核心业务，只做必要 self-host、API/webhook 验证和小范围二开。
- 第一阶段不重写 OpenHands。
- 第一阶段不把 Plane 当高频 heartbeat/log 存储。
- 第一阶段不做完整 CI/CD 发布平台，只记录 release/deploy gate 和执行结果。
- 第一阶段不做多租户计费和强隐私隔离，按个人/小团队内部系统设计。

## Plane 与 Control Plane 边界

Plane 面向人，负责“要做什么、做到哪一步、谁来 review”：

- project / work item
- state / comment / attachment
- repo 字段展示
- User Agent / Prompt / Project Workspace 的可编辑配置
- human review gate
- agent run 链接展示
- Codex run / 可选 OpenHands / 可选 Langfuse 跳转入口

Control Plane 面向 agent runtime，负责“哪个 agent 什么时候接单、怎么跑、跑成什么样”：

- task mirror
- Plane 配置的 runtime projection
- repo routing snapshot
- run / lease / heartbeat / retry
- prompt binding projection / prompt release
- Codex run event / 可选 OpenHands conversation ref
- 本地 trace/cost summary / 可选 Langfuse trace ref
- state transition validation

Plane 是可编辑配置的产品事实源；Control Plane 是执行事实源。Plane 可以展示 agent 状态，但不承载高频 heartbeat、retry、token、conversation event log 和 prompt release 事实源。

## 用户角色

| 角色           | 诉求                                                 |
| -------------- | ---------------------------------------------------- |
| Owner          | 管理 team/project/repo/prompt，查看 agent 成本和质量 |
| Product/PM     | 创建任务、指定 repo、查看状态、做人工 review         |
| Engineer       | 查看 agent 变更、PR、测试结果、打回返工              |
| Agent Operator | 查看运行队列、lease、失败重试、日志和 trace          |
| Agent          | 读取任务上下文、加载 prompt、执行代码、回写结果      |

## 核心对象

| 对象             | 说明                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Team             | 业务团队，例如 `token-team`、`tiktok-team`                                               |
| Project          | 产品/业务项目，例如 `token`、`tiktok-test`                                               |
| Repository       | 代码仓库，例如 `crs-src`、`sub3`、`traffic`                                              |
| Task             | 从 Plane 同步来的任务                                                                    |
| Role             | agent 角色，例如 Intake、Development、Code Review、Merge                                 |
| Agent Definition | Plane 里配置的 User Agent runtime projection，包含模型、工具、权限、默认 prompt binding  |
| Prompt Component | Plane Prompt 的 runtime projection，可按 agent/project/role/playbook/task/workspace 叠加 |
| Prompt Release   | prompt 版本发布结果                                                                      |
| Run              | 一次 agent 接单执行                                                                      |
| Conversation     | 执行器会话引用；第一版以 Codex run event 为主，OpenHands 为可选                          |
| Trace            | 本地 trace/cost summary；Langfuse trace 为可选增强                                       |

## 状态机

主链：

```text
Backlog
-> Todo
-> Development
-> Code Review
-> Human Review
-> In Merge
-> Merged
-> Ready for Release
-> In Release
-> Released
-> Ready for Deployment
-> Deployment
-> Deployed
-> Done
```

自动执行状态：

```text
Todo
Development
Code Review
In Merge
In Release
Deployment
```

人工判定状态：

```text
Human Review
Merged
Ready for Release
Released
Ready for Deployment
Deployed
Done
Canceled
```

允许短路：

```text
任意非终态 -> Done
任意非终态 -> Canceled
```

允许返工：

```text
Code Review -> Development
Human Review -> Development
Merged -> Development
Released -> Development
Deployed -> Development
```

返工规则：

- 人类或 reviewer 打回时，必须写明问题来源。
- Agent 每次接单前必须读取任务描述、所有有效评论、最新 workpad、PR review feedback。当前 prompt 注入的是 unresolved feedback；任务级 `agent_progress` 只供人查看接单/完成/失败进度，不注入下一次 prompt，避免 agent 把状态流水当成返工要求。
- Development agent 必须把返工建议写入本次 run 的 workpad 和最终 summary。

当前实现状态：

- `GET /api/tasks` 已支持按 mode/state/project/repository/lease/retry 查询任务队列。
- `/tasks` 已支持查看 agent、human、blocked、terminal 任务。
- `/tasks/[taskId]` 已支持查看任务详情、最近 runs、未解决 feedback、允许状态流转。
- Task 只读观察面面向 viewer 开放；`transition`、`rework`、`feedback` 等任务变更 API 需要 owner/admin，避免非授权角色越过人工 gate。
- `POST /api/tasks/[taskId]/transition` 已支持按状态机校验并推进任务状态。
- `POST /api/tasks/[taskId]/rework` 已支持写入 actionable feedback，并按状态机把任务退回 `Development`。
- Worker 下一次领取 `Development` 时会把 unresolved feedback 注入 prompt release。
- `PLANE_WRITEBACK_ENABLED=true` 时，人工 gate transition 和 rework API 会回写 Plane state/comment；`pnpm plane:human-gate-writeback-smoke` 已覆盖 Web API 到 Plane writeback helper 的本地 contract，`pnpm plane:writeback-smoke` 已支持真实 Plane 写后回读验证。真实 Plane project 上的人工 gate 操作仍待复测。

## 任务分发规则

任务被 Agent Control Plane 接单的最低条件：

- task 属于启用的 team/project。
- task 有明确 repo。
- task 处于自动执行状态。
- task 没有被其他 active run 持有 lease。
- task 没有 `blocked` 或 `human-required` 标记。

repo 必填规则：

```text
project = token
repo = crs-src | sub3 | traffic
```

未来所有 token project 任务不再拆成多个 Linear/Plane project，而是在同一个 project 下通过 repo 字段路由。MVP 允许 `repo:<name>` label 兜底，但正式方案应二开 Plane 字段。

## Prompt 装配

Prompt 不再以 GitHub Markdown 为权威源。用户在 Plane 创建和绑定 Prompt；Control Plane 按 Plane 同步来的 projection 生成不可变 prompt release。Prompt 语义是叠加，不是隐式覆盖。平台按以下顺序动态装配：

```text
agent prompt
+ project prompt
+ role prompt
+ playbook prompt
+ task prompt
+ workspace prompt
+ comments/workpad
+ runtime constraints
```

每个 prompt component 必须有：

- name
- scope
- version
- status: draft / active / archived
- content
- author
- changelog

每次 run 必须记录实际使用的 prompt release id，保证可追溯。

Phase 1 版本规则：

- Prompt 保存后立即生成新版本，并成为 latest。
- Prompt Binding 决定使用 `latest` 还是 `pinned`。
- Agent 配置保存后影响后续新 run，但 Phase 1 不暴露用户可选 Agent old version。
- Run 创建时冻结 resolved prompt versions、agent config snapshot 和 assembled prompt preview。

Prompt Preview 必须展示 prompt stack、来源、scope、版本、顺序、变量渲染结果、最终 assembled prompt 和 available secret keys。Secret value 不预注入 prompt；Agent 使用 secret 时按 key 通过 worker runtime 解析。

当前实现状态：

- Seed 已提供 team / repo / role 三类 active prompt component 和 binding。
- Worker 会在 adapter 执行前生成不可变 prompt release。
- `prompt_release_components` 会记录每个组件及其顺序和 hash。
- `runs.prompt_release_id` 会绑定本次执行实际使用的 prompt release。
- `GET /api/prompt-releases?limit=5` 可查询最近 prompt release。
- `GET/POST /api/prompt-components` 已支持查询和创建 prompt component version。
- `GET /api/prompt-components/[componentId]` 已支持查看 component 详情和历史版本。
- `POST /api/prompt-components/[componentId]/activate` 已支持激活某个版本，并将同名同 scope 其他版本归档，同时把 active binding 指向新版本。
- `POST /api/prompt-components/[componentId]/archive` 已支持归档。
- `GET /api/prompt-components/diff?from=&to=` 已支持版本 diff。
- `GET /api/prompt-components/[componentId]/metrics` 已支持查看该版本关联 release/run 数、成功率、token、成本和最近 runs。
- `GET /api/settings` 已支持读取 Project Settings 所需基础数据和 prompt bindings。
- `POST /api/settings/repositories/[repositoryId]` 已支持更新 repository 配置。
- `POST /api/settings/repositories` 和 `POST /api/settings/repositories/[repositoryId]/archive` 已支持新增和归档 repository。
- `POST /api/settings/roles/[roleId]` 已支持更新 role 配置。
- `POST /api/settings/roles` 和 `POST /api/settings/roles/[roleId]/archive` 已支持新增和归档 role。
- `POST /api/settings/agent-definitions/[agentDefinitionId]` 已支持更新 agent definition 配置。
- `POST /api/settings/agent-definitions` 和 `POST /api/settings/agent-definitions/[agentDefinitionId]/archive` 已支持新增和归档 agent definition。
- `GET/POST /api/prompt-bindings` 已支持 binding 列表和创建；新建 binding 默认 `pending`，且需要 `prompt_editor` / `prompt_admin` / `admin` / `owner`。
- `POST /api/prompt-bindings/[bindingId]/status` 已支持批准、拒绝、禁用和重新提交，且需要 `prompt_admin` / `admin` / `owner`，并写入带 actor 的 `audit_events`。
- `/prompt-components` 和 `/prompt-components/[componentId]` 已提供最小 Prompt Manager UI。
- `/prompt-components/[componentId]` 已展示该版本关联的 run 质量、token 和成本指标。
- `/settings` 已支持查看 team/project/repository/role/agent definition，编辑 repository/role/agent definition，并按 operator 权限创建、批准、拒绝、禁用、重新提交 prompt binding。
- Prompt Binding 最小 RBAC、审批人模型、最近审计视图、基础审计筛选、高级审计视图、DB-backed operator user、operator signed session 最小登录态、session 管理页面、用户管理界面（含 owner/admin 创建和更新）和细粒度页面/API 权限已实现。

## 执行器集成

默认目标形态下，Agent Control Plane 不自研模型执行器，也不新增付费执行平台，而是参考 Symphony 调用本机已有 Codex CLI / `codex app-server`：

1. 准备 repository workspace 或 per-run git worktree。
2. 指定 workspace/repo。
3. 注入已装配 prompt。
4. 启动 Codex app-server / turn。
5. 监听 Codex event stream。
6. 保存 run event、progress、workpad、token/cost 摘要和 run result。
7. 根据结果更新 Plane 状态。

Codex CLI adapter 负责：

- agent loop
- event stream
- workspace
- shell/file/tool execution
- turn completed / input required / failed / stalled 结果判断

当前实现状态：

- Worker 已能 claim run、写入 running/heartbeat/succeeded，并把 task 推进到角色默认下一状态。
- Worker 已引入 `ExecutionAdapter` 抽象，已新增 `codex-cli` adapter 最小实现和 `pnpm codex:adapter-smoke` 本地 smoke；当前实现先走 `codex exec --json`，生产默认 profile 和 long-lived `app-server/thread/turn` 模式仍待补齐。
- Worker 已在 adapter 执行前准备 workspace，并把 workspace path/strategy/base/head ref 注入 execution adapter。
- Worker 已可把 adapter 返回的 event stream 摘要写入 `run_events`，run detail 可展示 agent message、tool call、file operation、shell 和 LLM generation 事件 payload；OpenHands Cloud adapter 会从 conversation payload 的 `events` / `event_log` / `eventLog` / `messages` 及其常见嵌套列表容器中提取摘要，payload 暴露同源 event log URL/URI 时会额外拉取 event log 生成摘要；payload 未暴露 URL 时可用 `OPENHANDS_EVENT_LOG_PATH_TEMPLATE` 配置同源 event API fallback，并在 payload 或 event log 暴露 trace id 时提取 trace refs。Control Plane 只保存脱敏后的轻量摘要，不复制完整 OpenHands event log。
- Worker 已可捕获 adapter throw/timeout/API error，写入 `openhands.adapter_error`，并将 run 标记为 retryable failed。
- Worker 已能保存 adapter 返回的 conversation ref。
- `openhands-cloud` adapter 已按官方 V1 REST API 实现：创建 conversation、轮询 start task、轮询 execution status。
- `openhands-cloud` adapter 已有 terminal status 映射：`finished/completed/succeeded -> succeeded`，等待确认/用户输入和 stuck/blocked/paused 类状态进入 non-retryable failed，sandbox error/missing/lost/unavailable/terminated 与 execution error/failed/crashed/timeout 类状态进入 retryable failed，cancelled/aborted/stopped 进入 non-retryable failed。
- OpenHands Cloud adapter 保留为可选集成，不进入默认完成门禁；当前没有 OpenHands API key，也不购买 OpenHands Cloud。
- `codex-cli` adapter 已有第一阶段实现；新的 P4 主线是完成 profile-gated cutover、真实 Plane task 端到端验证，以及按需补齐 `codex app-server` 长会话模式。

## 观测集成

默认观测由 Control Plane 自身负责：

- prompt release 快照
- run events
- task progress / workpad
- conversation-like 事件摘要
- token/cost 估算
- agent status
- audit events

Langfuse 不再作为默认必需链路。它只作为未来可选 observability plugin，用于团队规模扩大、需要更强 eval/annotation/trace 分析时再接入。

当前实现状态：

- Worker 已能保存 adapter 返回的 trace refs。
- `trace_refs` 写入时会同步汇总 run token/cost。
- mock adapter 已能生成 mock trace ref，供 run detail 链路验证。
- Worker 已接入 `@langfuse/tracing` / `@langfuse/otel` run-level instrumentation。
- `LANGFUSE_ENABLED=true` 且 Langfuse credentials 存在时，worker 会为每次 run 创建 `agent-run` observation；observation input 包含最终 rendered prompt，output 包含 run status / summary / failure reason，并把 Langfuse trace id 写回 `trace_refs(provider=langfuse)`。
- `LANGFUSE_PROJECT_ID` 存在时，run detail 可通过 `trace_refs.ui_url` 跳转 Langfuse trace。
- Langfuse integration 保留，但默认关闭；当前没有 Langfuse Cloud，也不购买付费 Langfuse 服务。
- Langfuse self-host OSS 理论上可免费部署，但第一版也不作为必需项，避免增加运维负担。

Trace 策略：

- Control Plane 默认保存最终 prompt 快照、run event 摘要、trace 引用和 token/cost 摘要。
- 若未来接入 Langfuse，只能作为增强观测，不得阻断基础 agent 执行链路。
- 不做复杂脱敏管线，只做最小 secret 防护：不主动把 `.env`、API key、SSH key 写进 prompt 或 trace；写入 `run_events` 的 OpenHands 本地摘要会脱敏常见 API key、token、secret、password、Bearer token 和 `sk-*` key。

## 页面需求

### Task Queue

- 按 team/project/repo/state 过滤。
- 展示可接单、运行中、阻塞、等待人工 review 的任务。
- 展示当前 lease owner、heartbeat、run duration。
- 展示 latest/active run 的 attempt、lease expiry、retryable/non-retryable 和 retry-after，帮助判断 agent 是否接单、租约是否快过期、失败何时重试。
- 展示任务级 Progress / Workpad；`agent_progress` 由 worker 写入，不混入 unresolved feedback。
- 提供人工 gate 操作入口，例如通过、打回、短路 Done/Canceled。

当前实现状态：

- `GET /api/runs` 和首页 recent runs 已能观察 agent 是否 claimed/running/succeeded/stalled。
- `/tasks` 和 `/tasks/[taskId]` 已能展示 latest/active run 的 attempt、lease owner、lease expiry、heartbeat、retryable 和 retry-after。
- `/tasks` 队列页已支持 mode/state/project/repository/lease/retry 筛选，其中 lease 支持 `active` / `none` / `expired`，retry 支持 `retryable` / `waiting` / `ready` / `blocked`。
- `/tasks` 队列页已展示 latest/active run 的 attempt、lease owner、lease expiry、heartbeat、retryable 和 retry-after 摘要。
- `/tasks/[taskId]` 详情页已支持人工通过、短路 Done/Canceled、打回 Development。
- `/tasks/[taskId]` 详情页已展示接单、lease、latest run、retry/backoff 和 run timeline。
- `/tasks/[taskId]` 详情页已展示 Progress / Workpad，读取 `feedback_items(source=agent_progress)`。
- `POST /api/tasks/[taskId]/feedback` 可写入 `feedback_items(source=pr_review)` 等 unresolved feedback；设置 `requestRework=true` 时会打回 Development 并触发 Plane writeback。
- `WORKER_REPOSITORY_CONCURRENCY_LIMIT` 和 `WORKER_ROLE_CONCURRENCY_LIMIT` 可限制同 repo / 同 role 的 active runs；dispatch 会在内存侧跳过超限任务，DB claim 会用 advisory lock 串行检查，避免多 worker 同时越限。
- `WORKER_AGENT_CONCURRENCY_LIMIT` 可限制同一 agent definition 的 active runs；DB claim 会在同 role active agent definitions 中优先选择当前 active run 更少的 agent。
- `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` 可限制单 run 估算成本；超过预算的任务不会派发给 agent，会自动进入 `Blocked`，并写入任务级 Progress / Workpad 说明预算超限原因，等待人工拆分、调参或提升预算后再打回 Development。
- `/settings` Dispatch Policy 和 `PUT /api/dispatch/policy` 可写入 `app_settings(dispatch.max_estimated_cost_usd_per_run)` 和 `app_settings(dispatch.queue_priority_policy)`；Worker 下一轮派发优先读取 DB 持久化配置，未配置时回退 `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` / `WORKER_QUEUE_PRIORITY_POLICY`。
- Plane 同步当前会解析 `cost:<usd>` label，例如 `cost:1.25`，写入 `tasks.estimated_cost_usd` 供 dispatch budget policy 使用。
- Task Queue 和 dispatch snapshot 当前支持 `priority_first` / `priority_aging` / `repo_fair` / `weighted_priority` / `oldest_first` / `newest_first` 六种队列排序；默认可用 `priority_aging`，按 `coalesce(priority, 1000000) - floor(wait_hours / 24)` 再 priority/更新时间排序，避免低优先级任务长期饥饿；多 repo 爆发时可切到 `repo_fair`，按 repo 内 priority/updated_at 排队后跨 repo 轮转；成本敏感时可切到 `weighted_priority`，同等优先级下低估算成本任务更早执行。
- 状态转移会写入 `audit_events`，打回会写入 `feedback_items`。
- `PLANE_WRITEBACK_ENABLED=true` 时，transition/rework API 响应会包含 `planeWriteback` 结果，用于确认是否已同步 Plane。

### Agent Runs

- 查看每次 run 的状态、耗时、token、成本、结果。
- 跳转 OpenHands conversation。
- 跳转 Langfuse trace。
- 展示本次使用的 prompt release。

当前实现状态：

- 首页已展示最近 runs 和 prompt releases，并从最近 runs 区块跳转 `/runs` 列表。
- `/runs` 已提供 run 列表筛选 UI，可按 status、repo、role、task identifier 和 limit 过滤执行记录。
- Run detail 已展示 task/repo/agent、lease、时间、结果、run events、prompt release、conversation ref 和 trace ref；当 OpenHands / Langfuse 返回 UI URL 时，页面提供可点击外链。
- Prompt release detail 已展示上下文、hash、component 明细、关联 runs 和 rendered prompt。
- OpenHands conversation 当前可展示 mock adapter 写入的 ref；OpenHands Cloud 返回 `ui_url` / `event_log_uri` 时可直接跳转；event timeline 当前可展示 mock adapter 和 OpenHands Cloud conversation payload 摘要出的 agent/tool/file/shell/status/LLM generation 事件，真实 OpenHands 细粒度 event API 仍依赖后续 P4 smoke。
- Langfuse trace 当前可展示 mock adapter 写入的 ref；真实 Langfuse `ui_url` 存在时可直接跳转，并展示 token/cost/latency 摘要；真实 Langfuse prompt/output 仍依赖后续 P5。

当前 UI 验收边界：

- Run detail 已能展示 workspace、prompt release、conversation ref、trace ref 和本地 `run_events` timeline。
- 本地 `run_events` timeline 是 Control Plane 脱敏摘要流，不等同于 OpenHands 完整 event log。
- OpenHands/Langfuse UI 跳转只属于 optional/legacy profile；启用时必须等真实 optional smoke 后才能标记该可选能力完成。

### Prompt Manager

- 创建 global/team/project/repo/role prompt。
- diff prompt version。
- 发布 active 版本。
- 回滚到旧版本。
- 查看某 prompt version 关联的 run 质量和成本。

当前实现状态：

- prompt component 列表、详情、创建新版本、激活、归档和 diff 已有 API。
- `/prompt-components` 可创建和筛选 component。
- `/prompt-components/[componentId]` 可查看内容、历史版本、diff，并保存新版本。
- `/prompt-components/[componentId]` 可查看该版本关联的 run 质量、token 和成本。
- 激活旧版本可作为最小 rollback 路径。
- 激活版本会将同名同 scope 的其他版本归档，并把现有 active binding 指向被激活版本。
- 激活操作会写入 `audit_events(action=prompt_component.activate)`。
- Prompt Binding 读取、创建、批准、拒绝、禁用、重新提交已有 API 和最小 UI，并已接入 operator role 门禁和 actor audit。

### Project Settings

- 管理 repo 列表。
- 管理状态机映射。
- 管理 repo routing 规则。
- 管理 agent role 到 agent definition 的绑定。

当前实现状态：

- `/settings` 已展示 team、project、repository、role、agent definition。
- `/settings` 已支持新增、编辑、归档 repository、role、agent definition。
- `/settings` 已展示 prompt bindings，并按 operator 权限支持创建、批准、拒绝、禁用、重新提交。
- `/settings` 已展示审计事件，并支持按 entity type、action、actor、limit 筛选；`GET /api/audit-events` 提供同等查询能力，并返回 action/entity/actor 聚合摘要。
- `/audit` 已提供高级审计视图，可按 entity type、action、actor、时间窗口和 limit 筛选，展示总量、唯一 actor、时间范围、Top action/entity/actor 和最近事件。
- repo、role、agent definition 新增、编辑、归档已有最小 API/UI；operator password 登录、DB-backed operator user、signed session cookie、`/api/auth/session`、`/session`、`/users`、`POST /api/users` 和细粒度页面/API 权限已完成最小闭环。

## MVP 范围

第一阶段：

- Plane project/task 同步。
- 单 project 多 repo 路由。
- 平台化 prompt component CRUD。
- Prompt 装配并生成 prompt release。
- OpenHands SDK 执行一次 Development run。
- 保存 run/conversation/trace 引用。
- 状态同步回 Plane。
- 基础 run 列表和详情页：已完成最小 UI、筛选和权限门禁。

### 部署与门禁

当前实现状态：

- `Dockerfile` 已提供 monorepo production build。
- `docker-compose.yml` 已提供 PostgreSQL、migration、Web 服务；Worker 通过 `worker` profile 启动，避免默认抢任务。
- `.github/workflows/ci.yml` 已提供 release gate：PostgreSQL service、migration + seed、format、check、build。
- `.env.example` 已覆盖 Web/Worker/Plane/OpenHands/Langfuse/Compose 所需环境变量。
- `pnpm release:image` 已提供镜像发布脚本，支持 OCI revision label 和可选 push。
- `pnpm deploy:compose` 已提供固定 `ACP_IMAGE` 的 Compose 部署脚本。
- `pnpm rollback:compose` 已提供 Web/Worker 应用镜像回滚脚本；数据库回滚必须走备份恢复。
- `pnpm db:backup` 和 `pnpm db:restore` 已提供 PostgreSQL 备份/恢复脚本，恢复需要显式 `CONFIRM_RESTORE`。
- 基础运行监控 dashboard、基础告警、阈值 UI/API 动态配置、generic/slack/email webhook 告警通知、告警失败重放队列、secret validate gate、secret env file/rotation/expiry warning 最小链路、secret rotation audit log、外部 secret command 接入、secret provider smoke、provider-side audit file/command smoke、production smoke harness、可选外部依赖只读探针、cutover gate、本地 cutover rehearsal harness 和 12h/24h/7d run 趋势已完成；真实端到端外部 smoke、真实 task-source cutover 样本、真实 secret provider command、真实供应商账号/API 审计 smoke 和真实完整 cutover rehearsal 仍未完成。

第二阶段：

- Code Review / In Merge / In Release / Deployment 角色。
- 人工 gate 页面：已完成最小 UI，已具备 Plane 回写骨架、API 级 writeback contract smoke 和 owner/admin mutation 权限保护，仍需补真实 Plane apply smoke。
- retry/backoff/lease 深度筛选。
- Langfuse eval 和人工标注。
- 多 agent 并发策略。

第三阶段：

- 替换更多 Symphony 内部逻辑为自建 Control Plane。
- 支持 webhook 优先、polling 兜底。
- 支持 project/repo/role prompt A/B。
- 支持成本预算和自动熔断。

## 验收标准

- 用户可以在平台创建 agent prompt，而不是改 GitHub 文件。
- 用户可以创建 token project 下的任务，并通过 repo 字段分发到正确仓库。
- 用户可以看到 agent 已接单、运行中、完成、阻塞。
- 用户可以打开一次 run，看到 Codex run events、Progress / Workpad、prompt release、workspace、summary 和成本摘要。
- 用户可以在启用可选观测集成时打开 Langfuse trace；默认第一版不依赖它。
- Agent 完成后可以自动推动任务进入下一个状态。
- 人类可以在 review gate 打回 Development，并且 agent 下一次能读到打回意见：API、UI、prompt 注入、Plane 回写骨架和 API 级 writeback contract smoke 已完成；Plane writeback smoke harness 已支持写后回读验证，真实 Plane project 上的人工 gate 操作仍待复测。

## 关键风险

- Plane API/webhook 能力需要验证，不足时要补 adapter 或退回 polling。
- Codex CLI / app-server 能力边界需要验证模型、工具、权限和 workspace 隔离。
- 可选 Langfuse trace 会记录完整上下文，只有未来启用时才进入权限和脱敏评审；默认第一版用本地 run events / Progress / Workpad。
- Prompt 平台化后必须有发布流程，否则线上 agent 行为会被随意改坏。
- 多 repo 任务如果 repo 字段缺失，必须拒绝接单，不能猜。
