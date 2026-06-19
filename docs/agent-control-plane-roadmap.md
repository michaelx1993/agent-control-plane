# Agent Control Plane Roadmap

## 开发原则

- 先跑通闭环，再扩大自动化范围。
- Plane 只做人类任务面板，不承载高频 agent runtime。
- Plane 必须 self-host，并以未来二次开发为前提。
- Control Plane 持有调度状态、lease、run、prompt release 关联。
- OpenHands 持有执行过程、conversation、event log。
- Langfuse 持有 prompt registry、LLM trace、token/cost、eval。
- 每个阶段必须能独立验收，不能依赖“大重构完成后才可用”。

## 总体阶段

```text
P0 方案固化
-> P0.5 Plane Self-host Spike
-> P1 Plane 任务层接入
-> P2 Control Plane Runtime
-> P3 Prompt 平台化
-> P4 OpenHands 执行层
-> P5 Langfuse 观测层
-> P6 状态机闭环
-> P7 多 repo / 多 project / 多 agent
-> P8 生产化与迁移
```

当前实现快照：

- 已有 Next.js Control Plane web console 和 worker app。
- 已有 PostgreSQL/Prisma 数据模型、seed、demo run。
- 已有 Plane task webhook receiver、task mirror、repo label 兜底解析。
- 已有 Plane polling fallback cursor 分页 reconciliation，避免 live worker 只同步第一页任务。
- Plane webhook 与 polling fallback 复用同一 DB upsert 语义，同步 repo、priority、assignee、
  labels、state 和 sync cursor。
- 已有 run/lease/heartbeat、expired lease stalled blocking、OpenHands event summary persistence。
- OpenHands terminal failed/stuck results will still persist conversation refs, event cursor, and
  external events before the worker marks the run failed.
- 已有 Prompt Manager、prompt component/binding/release、scope lookup API、prompt diff 和 rollback。
- Worker 在交给 OpenHands 和保存 prompt release snapshot 前，会对运行时 prompt 执行最低限度
  secret redaction，覆盖常见 API key、bearer token 和 private key block。
- 已有 `pnpm secrets:check` 高置信度 secret 泄露扫描，并纳入 `pnpm release:check`。
- 已有 OpenHands adapter、workspace 记录和注入、Run Detail workspace 可视化、可配置 runtime endpoint paths、conversation refs、poll heartbeat hook。
- 已有 Langfuse trace refs、可配置 trace/generation endpoint paths、token/cost summary 写入、prompt version metrics 和 dashboard 展示。
- 已有 Plane 低频状态 comment：Claimed / Running / Completed / Failed。
- Live 模式下 final Plane 状态/comment 回写是强制门禁；失败时 run 标 failed，本地 task
  不推进，避免“agent 完成但 Plane 没切状态”的假阳性。
- 已有 Run Detail feedback 表单和 feedback API，支持打回 Development。
- 已有 Operator Timeline API/UI，聚合 run event、audit event、feedback。
- 已有 Audit Log API/UI，支持按 action/entity type 查询 operator action 与 payload。
- 已有 Readiness API/UI，展示 Plane/OpenHands/Langfuse/DB/Worker 配置缺口，并在 DB 配置后展示 seed baseline 状态。
- 已有人工 task transition API 和控制台操作入口，状态跳转受 state-machine 校验。
- 已有 feedback resolve API/UI，处理完成的反馈不会继续作为 unresolved rework context 注入后续 Development。
- 已有 `CONTROL_PLANE_API_TOKEN` 保护 operator write APIs；只读 dashboard APIs 可用
  `CONTROL_PLANE_READ_API_TOKEN` 单独保护，未配置时回退到 `CONTROL_PLANE_API_TOKEN`，两者都未配置时保持本地开发开放。
- `pnpm live:preflight` 会校验 DB 连通性和 Control Plane seed baseline，避免空库启动 live worker。
- `pnpm plane:probe` 可对 self-host Plane work-items API、project labels、repo 路由解析、
  可选 PATCH/comment mutation 做 spike 验证；2026-06-19 本机 self-host Plane 已通过
  non-mutating 和 mutating probe，并从 Plane label ID 解析出 `repo=crs-src`，PATCH/comment
  写链路已在 disposable `P0.5 smoke test` 上验证。
- Plane custom property `repo` 已实测不足：PATCH 不报错但 GET 不回显，DB `issues` 表无
  custom field 存储列。P1 repo routing 决策为继续使用 `repo:<name>` label fallback；
  Plane fork `michaelx1993/plane` 已存在，默认分支 `preview`，正式字段二开延后到需要页面展示、
  filter/order 或强类型字段时。
- `pnpm live:dispatch-once` 会先执行 live preflight，再派发一个真实任务，并输出 task/run/
  OpenHands/Langfuse/next-state evidence bundle 用于 Development run smoke test。
- `pnpm live:verify-once` 会在 one-shot live dispatch 后校验 evidence bundle，缺少 Plane、
  workspace、OpenHands、Langfuse 或 Run Detail 证据时失败；成功 run 会强制校验 OpenHands/
  Langfuse URL 与 run refs 一致，并校验 post-dispatch `task.state` 已推进到 `run.nextState`、
  Plane final state evidence 一致且存在 Plane completion comment evidence。
- `pnpm release:check` 在 live 模式会强制校验非空且 `pg_restore --list` 可解析的数据库备份，再执行 live preflight。
- 已有 `pnpm backup:drill`，可将备份还原到隔离 drill 数据库并校验 Control Plane seed
  baseline；`REQUIRE_RESTORE_DRILL=1` 可把它纳入 live release gate。
- 已有 Docker Compose `app` profile 和 app Dockerfile，可启动 web console 与
  `WORKER_RUN_LOOP=true` 的常驻 worker。
- 已有 `pnpm deploy:compose` 和 `pnpm rollback:compose`，串联 release gate、compose app profile、
  backup restore 和 health check。
- `pnpm compose:check` 会校验 Docker Compose app profile，并已纳入 release gate。
- 已有 `CONTROL_PLANE_API_TOKEN` operator write API 门禁，保护人工 transition、retry、
  feedback 和 prompt 写操作。
- 已有 `CONTROL_PLANE_READ_API_TOKEN` 可选只读 API 门禁，保护 tasks/runs/timeline/audit/
  monitoring/readiness/prompt read endpoints。
- 控制台已有 `Operator Token` 面板，浏览器侧会把 token 附加到受保护写操作。
- 控制台 Task Queue 已支持人工推进下一状态、打回 Development、转 Blocked、Done 或 Canceled。
- 控制台 Task Queue 和 `/api/tasks` 已支持按 team/project/repo/state 过滤。
- Run Detail 已支持将 feedback 标记 resolved，减少返工上下文重复注入。
- Run Detail 已有 Progress / Workpad 面板，将 run events 派生成 operator 可读进度和当前工作摘要。
- Task Queue 可区分 repo concurrency、role concurrency、retry capped、budget blocked 和普通 gate。
- 已有 Linear 离线迁移草案工具，可将 JSON/CSV export 转换为 Plane import draft，并标出缺失 repo 的任务。

当前完成度判定：

- 本地/operator MVP：约 72%，已具备 mock worker、DB demo run、控制台、prompt 管理、timeline、audit log、readiness、feedback/rework、人工 transition。
- 真实任务执行闭环：未完成。关键缺口是 Plane self-host 实测、OpenHands live execution、Langfuse live trace。
- 生产化替代 Symphony：未完成。还需要部署、权限、配置管理、备份恢复、错误恢复、长任务稳定性和操作审计完善。

下一阶段优先级：

1. 启动并验证 Plane self-host，确认 work item API、webhook、repo 字段方案。
2. 运行 `pnpm live:preflight`，确认 DB seed baseline、Plane、OpenHands、Langfuse 基础连通。
3. 配置 `WORKER_MODE=live`，用真实 OpenHands endpoint 跑一次 Development 任务。
4. 接入真实 Langfuse trace，确认 run detail 能跳转并展示 token/cost。
5. 将 live run 的 Plane 状态回写和低频 comment 验证通过。
6. 固化部署/回滚/备份 runbook。

## P0 方案固化

目标：把产品边界、数据模型、状态机和集成边界定死。

模块：

- PRD
- ERD
- 状态机
- 权限模型
- Prompt 装配规则
- 外部系统边界

交付物：

- `docs/agent-control-plane-prd.md`
- `docs/agent-control-plane-erd.md`
- `docs/agent-control-plane-roadmap.md`

验收标准：

- 明确 Plane / Control Plane / OpenHands / Langfuse 各自职责。
- 明确 task 必须指定 repo。
- 明确 prompt 装配顺序。
- 明确哪些状态自动执行，哪些状态人工判定。

## P0.5 Plane Self-host Spike

目标：验证 Plane self-host、API、webhook、字段扩展和二开入口，不在假设上启动 P1。

模块：

- Plane self-host deployment
- Plane API exploration
- Plane webhook exploration
- Repo 字段验证
- Work item 状态映射验证
- Plane fork 策略验证

关键能力：

- 本地或服务器启动 Plane self-host。
- 创建 team/project/work item。
- 验证 work item API 读写。
- 验证 webhook 是否能覆盖 create/update/comment/state change。
- 验证 repo 字段：优先 custom field 或二开字段，label `repo:<name>` 只做兜底。
- fork `makeplane/plane` 到 `michaelx1993`，确认后续二开路径。

交付物：

- `docs/plane-self-host-spike.md`，包含 self-host runbook、API/webhook capability matrix、repo 字段方案、fork 策略、风险和未验证项。
- Plane fork 仓库：`michaelx1993/plane`，以 `makeplane/plane:preview` 为同步基线。

验收标准：

- Plane 可 self-host 启动并登录。
- Control Plane 能通过 API 拉取 project/task。
- Plane task 状态和 repo 字段能被读取。
- Plane webhook 能触发本地 receiver，或明确需要 polling fallback。
- Work items API 路径 `/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/` 已实测。
- `pnpm live:preflight` 的 Plane check 能通过。
- API rate limit `60 req/min` 已纳入 polling 预算。
- 明确第一阶段是否需要改 Plane 源码。

风险：

- Plane 原生 custom field 能力不足，需要尽早二开。
- webhook 不完整时，P1 保留 polling fallback；代码策略为 60s 节流、`updated_since`
  reconciliation cursor 和 `per_page<=100`。

## P1 Plane 任务层接入

目标：用 self-host Plane 替代 Linear 作为任务和人工 review 面板。

模块：

- Plane API client
- Plane webhook receiver
- Plane polling fallback
- Team/project/task 同步
- Task 状态映射
- Repo 字段/label 解析

关键能力：

- 从 Plane 拉取 project/task。
- 接收 Plane task create/update webhook。
- webhook 漏事件时用低频 polling fallback 做 reconciliation。
- 将 Plane task 映射成本地 `tasks`。
- 解析 repo：优先 Plane 结构化字段，其次 label，例如 `repo:crs-src`。
- 同步状态变更回 Plane。

交付物：

- `plane_client`
- `plane_webhook_handler`
- `task_sync_service`
- `state_mapping`

验收标准：

- 创建 Plane task 后，本地能同步出 task。
- task 没有 repo 时，不会进入可派发队列。
- 修改 Plane 状态后，本地 task 状态能更新。
- 本地 run 完成后，能把状态和摘要写回 Plane。
- webhook 可选 `PLANE_WEBHOOK_SECRET`，对外暴露时必须配置。
- receiver 支持 Plane `X-Plane-Signature` HMAC-SHA256 raw body 验签。
- polling fallback 支持 60s 最小请求间隔、`updated_since` cursor、Plane cursor 分页和
  `per_page<=100`。

风险：

- Plane API/webhook 能力需要实测。
- 如果 Plane 原生自定义字段不足，先用 label 承载，再进入 Plane fork 二开。

## P2 Control Plane Runtime

目标：建立自己的 agent runtime 状态库，替代把 runtime 写进 Plane comments。

模块：

- Database migration
- Task queue
- Lease manager
- Run manager
- Heartbeat
- Retry/backoff
- Runtime event log
- Admin API

关键能力：

- 查找可派发任务。
- 创建 run。
- 获取/续租 lease。
- 记录 heartbeat。
- 记录 queued / claimed / running / blocked / completed / failed。
- 低频状态写回 Plane comment，但高频 heartbeat 只写本地。
- 失败后按策略 retry；默认 `WORKER_MAX_TASK_ATTEMPTS=3`，超过后停止自动派发，等待人工反馈或改状态。
- 对外提供 run 查询 API。

交付物：

- `teams/projects/repositories/tasks/runs/run_events` 表。
- `workspaces/feedback_items/users/audit_events` 最小表。
- `dispatch_loop`
- `lease_manager`
- `run_state_machine`
- 基础 HTTP API。

验收标准：

- 同一个 task 同一时间只能被一个 run 持有 lease。
- worker 崩溃后 lease 过期，任务可重新派发。
- 同一 task 的 run attempt 单调递增，达到 retry 上限后不再自动派发。
- Task Queue 明确展示 `retry capped` 和 `attempt/maxAttempts`，避免重试耗尽任务被误判为普通 gate。
- Operator 可以通过 `Release retry` 设置 task retry baseline，保留历史 run，同时打开新的自动派发窗口。
- heartbeat 超时可标记 stalled：run 进入 `blocked`，task 进入 `Blocked`，等待人工处理。
- run 状态变化不依赖 Plane comment。
- run detail 可展示 heartbeat、events、feedback、OpenHands/Langfuse 链接。
- dashboard 可展示 Operator Timeline，避免接单和完成状态只能从本地日志判断。
- readiness 面板能展示 live worker 所需环境变量是否齐全。

风险：

- lease 过短会误判长任务失败。
- lease 过长会导致崩溃恢复慢。

## P3 Prompt 平台化

目标：prompt 从 GitHub 文件迁移到平台管理。

Prompt 主库放在 Control Plane；Langfuse 只记录 prompt release 的 trace/eval 结果。

模块：

- Prompt Component CRUD
- Prompt Binding
- Prompt Release
- Prompt Renderer
- Prompt Diff
- Prompt Rollback
- Prompt permission

Prompt 装配顺序：

```text
global
+ team
+ project
+ repo
+ role
+ agent
+ task context
+ comments/workpad
+ runtime constraints
```

关键能力：

- 创建/编辑 prompt component。
- 将 prompt component 绑定到 team/project/repo/role/agent。
- 通过 scope lookup 选择绑定对象，避免手填 UUID。
- 对比两个 prompt component 版本的行级 diff。
- 将旧 prompt component 版本回滚为新的 active 版本，并归档同 scope/name 下旧 active 版本。
- 每次 run 前生成不可变 prompt release。
- 记录 prompt release 组成和 hash。
- 支持回滚 active prompt。

交付物：

- `prompt_components`
- `prompt_bindings`
- `prompt_releases`
- `prompt_release_components`
- Prompt Manager UI
- `/api/prompt-scopes`

验收标准：

- 不改 GitHub 文件即可修改 agent prompt。
- 每次 run 能看到实际使用的 prompt release。
- 被 run 引用的 prompt release 不可变。
- prompt 改动后只影响未来 run，不影响历史 run。

风险：

- prompt 平台化后必须限制权限，否则 agent 行为容易被误改。
- prompt 内容可能包含敏感信息，需要审计和访问控制。

## P4 OpenHands 执行层

目标：用 OpenHands SDK 承接 agent 执行、workspace、conversation 和 event log。

模块：

- OpenHands adapter
- Workspace manager
- Conversation manager
- Event stream consumer
- Result parser
- Execution timeout/stuck detection

关键能力：

- 根据 task/repo 创建 workspace。
- 创建 OpenHands conversation。
- 注入 prompt release。
- 启动 agent run。
- 订阅 event log。
- 保存 conversation ref。
- 将执行结果回传 Control Plane。

交付物：

- `openhands_adapter`
- `conversation_refs`
- OpenHands UI 跳转链接。
- Event cursor 同步。

验收标准：

- Development 任务可由 OpenHands 完成一次代码修改。
- `pnpm live:preflight` 的 OpenHands check 能通过。
- 用户能从 run detail 跳到 OpenHands conversation。
- OpenHands event log 中能看到 agent 消息、tool call、shell/file 操作。
- OpenHands 失败时，Control Plane 能记录失败原因并决定 retry/block。
- worker 轮询 OpenHands 期间按 `WORKER_HEARTBEAT_INTERVAL_MS` 刷新本地 lease。

风险：

- OpenHands 的工具权限模型要和现有 Codex 运行方式重新对齐。
- workspace 隔离、secret 注入、git 凭据需要单独验证。

## P5 Langfuse 观测层

目标：让每次 LLM 调用可追踪、可归因、可评估。

模块：

- Langfuse project setup
- Trace instrumentation
- Prompt registry integration
- Token/cost collector
- Trace linking
- Eval/annotation

关键能力：

- 每次 LLM call 写入 Langfuse trace。
- trace 关联 task/run/conversation/prompt release/repo/role。
- 收集 token、cost、latency。
- 从 run detail 跳转 Langfuse trace。
- 按 prompt version 统计成功率、平均成本、平均 token。
- Prompt metrics 页面/API 可按 prompt release 展示 run count、success rate、平均 token 和平均成本。
- Dashboard 展示 recent run tokens/cost。

交付物：

- `trace_refs`
- Langfuse SDK 集成。
- Prompt version metrics 页面。

验收标准：

- 用户能看到每次 LLM call 的 prompt、output、token、cost。
- 用户能按 prompt version 查看历史 run 表现。
- run detail 同时有 OpenHands conversation 和 Langfuse trace 链接。
- `pnpm live:preflight` 的 Langfuse check 能通过。

风险：

- trace 默认完整保存，调试便利优先；只做最低限度 secret 防护。
- Langfuse 与 OpenHands 的 callback/instrumentation 方式需要实测。

## P6 状态机闭环

目标：恢复并增强当前 Symphony 状态机能力。

模块：

- State transition engine
- Role router
- Human gate handler
- Feedback ingestion
- Plane sync writer
- Workpad/progress model

状态路由：

```text
Todo             -> Intake
Development      -> Development Agent
Code Review      -> Review Agent
Human Review     -> Human Gate
In Merge          -> Merge Agent
Merged            -> Human Gate
Release Version  -> Release Agent
Released          -> Human Gate
Deployment        -> Deploy Agent
Deployed          -> Human Gate
Blocked           -> Human Gate / Stalled
Done              -> Terminal
```

关键能力：

- 自动状态由 Control Plane 派发。
- 人工状态只等待用户操作。
- reviewer/human 打回后，Development agent 必须读到反馈。
- Run Detail 可以新增 feedback，并可选退回 Development。
- Run Detail 可以从 run events 查看 Progress / Workpad，不需要读原始日志判断 agent 是否卡住。
- agent 完成后只建议或执行允许的状态转移。

交付物：

- `state_transition_rules`
- `role_router`
- `feedback_collector`
- `plane_state_sync`
- Run Detail feedback form
- Run Detail Progress / Workpad panel

验收标准：

- Development 完成后能进入 Code Review。
- Code Review 发现问题能回 Development。
- Human Review 打回后能回 Development，并保留反馈。
- Development agent 下一次接单前能从 unresolved feedback 生成 comments。
- Merged/Released/Deployed 由人决定下一步。

风险：

- 状态流转权限要严格，避免 agent 越过人工 gate。
- Plane 与本地状态可能短暂不一致，需要 reconciliation。

## P7 多 repo / 多 project / 多 agent

目标：支持一个 team 下多个 project，一个 project 下多个 repo，多个 agent 并发执行。

模块：

- Repo routing
- Project routing
- Agent pool
- Per-role concurrency
- Per-repo concurrency
- Cost budget
- Queue priority

关键能力：

- token project 下通过 repo 字段分发到 `crs-src` / `sub3` / `traffic`。
- 不同 repo 使用不同 repo prompt。
- 不同 role 使用不同 agent definition。
- 同 repo 可限制并发，避免多个 agent 修改同一仓库冲突。
- 同 task 不允许重复执行。
- task 可用 `cost:<number>` 或 `estimated-cost:<number>` label 提供预算估算。
- 预算超限且策略为 `blocked` 时，Control Plane 将 task 标记为 `Blocked` 并写入 audit event。

交付物：

- `repository_routing_rules`
- `agent_pool`
- `concurrency_policy`
- `budget_policy`

验收标准：

- 同一 project 下不同 repo 任务能进入不同 workspace。
- repo prompt 能正确注入。
- role prompt 能正确注入。
- 超过并发限制的任务保持 queued。
- 超过预算的任务进入 blocked 或 waiting-approval；blocked 模式必须在 Task Queue 显示为
  `budget blocked`。

风险：

- 多 agent 并发可能造成 git/PR 冲突。
- repo label 缺失或错误会导致任务派发失败，必须早阻断。

## P8 生产化与迁移

目标：从当前 Linear/Symphony 实验环境迁移到新的平台化架构。

模块：

- Data migration
- Backfill
- Access control
- Audit log：已有 `/audit` 和 `GET /api/audit?action=&entityType=`，支持 retention window、
  CSV export、payload secret redaction。
- Secret management：已有 runtime redaction 和 release secret scan gate；后续可接入外部 secret
  manager 做凭据注入与轮换。
- Backup/restore：已有 `pg_dump` custom-format backup、`pg_restore` restore、live release
  前的 backup manifest integrity gate，以及隔离数据库 restore drill。
- Deployment：已有 Docker Compose app profile、deploy script、rollback script 和 health gate。
- Monitoring

关键能力：

- 迁移现有 team/project/repo/prompt。
- 从 Linear 导出未完成任务，导入 Plane。
- Linear export 可先通过 `pnpm linear:migration-plan` 生成可审查的 Plane import draft，再用
  `--apply --dry-run` 预览导入，最后用 `--apply` 创建 ready work items；重复导入会先查
  Plane 既有 `sourceId/sourceIdentifier` 标记并返回 `existing`，查重会遍历 Plane 分页。
- 保留旧 run/log 链接。
- 配置权限和审计。
- 部署 Control Plane。
- 监控 queue length、run success rate、token/cost、stalled runs。
- Monitoring Dashboard 第一版已提供 `/monitoring` 和 `GET /api/monitoring`，覆盖 queue
  length、run success rate、token/cost 和 stalled runs。

交付物：

- Migration scripts
- Deployment manifests
- Monitoring dashboard
- Runbook

验收标准：

- 新任务完全走 Plane。
- 新 prompt 完全走平台。
- 新 run 都有 OpenHands conversation 和 Langfuse trace。
- 旧 Linear 只保留归档，不再作为 agent 任务源。

风险：

- 迁移期间可能出现双写和重复派发。
- 需要冻结旧 Symphony poller 或确保只读。

## 推荐任务拆分

第一批任务：

1. 搭建 Control Plane repo 和基础服务框架。
2. 建库并实现 ERD 中 P1/P2 必需表。
3. 接入 Plane API，完成 task sync。
4. 实现 repo 必填校验和可派发任务查询。
5. 实现 run/lease/heartbeat。
6. 实现 prompt component/binding/release 最小模型。
7. 用 mock OpenHands adapter 跑通状态闭环。
8. 替换 mock 为真实 OpenHands SDK。
9. 接入 Langfuse trace。
10. 做 run detail 页面，展示 Plane task、OpenHands conversation、Langfuse trace。
11. 做 feedback/rework UI，并让下一轮 Development 读取 unresolved feedback。
12. 做 prompt scope 选择器，降低 prompt binding 配置错误。

## 里程碑

### M1: Task Sync 可用

- Plane task 能同步到本地。
- repo 缺失会阻断派发。
- 状态变更可双向同步。

### M2: Runtime Queue 可用

- run/lease/heartbeat/retry 可用。
- 可从 API 查看运行状态。
- Task Queue 可按 team/project/repo/state 过滤。
- Plane comment 只承载低频状态，不承载高频 heartbeat。

### M3: Prompt Platform 可用

- prompt 不再依赖 GitHub。
- 每次 run 绑定 prompt release。
- prompt binding 可通过平台 scope lookup 完成。

### M4: OpenHands Run 可用

- Development 任务可完成真实代码修改。
- conversation/event log 可查看。

### M5: Observability 可用

- Langfuse trace 可查看。
- token/cost 可统计。
- Dashboard 和 run detail 都能展示 token/cost。

### M6: Workflow 闭环可用

- Development -> Code Review -> Human Review -> In Merge 可跑通。
- 打回返工可跑通。
- feedback 可通过 UI/API 创建，且进入下一轮 Development 上下文。

## 当前待决策

- OpenHands workspace 用本机目录、Docker 还是远程 runtime。
- 是否保留 Symphony 名字，还是新建独立 Control Plane。

## 已定决策

- Plane 使用 self-host，后续一定可二开。
- repo 字段正式方案不长期依赖 label；label 只作为 MVP 兜底。
- Prompt 主库放 Control Plane，Langfuse 做 trace/eval。
- Langfuse 默认保存完整 trace。
- Control Plane 与 Plane 职责分离：Plane 管人类任务，Control Plane 管 agent runtime。
- Control Plane 技术栈采用 Next.js web app + worker + packages monorepo。
- 数据库直接使用 PostgreSQL + Prisma。
- Agent Control Plane 是替代 Symphony 的新编排层，Symphony 名字不再作为核心产品名。

## 仍需讨论

- OpenHands workspace：本机目录、Docker sandbox、远程 runtime 哪种作为第一版。
- Plane 二开深度：只改字段/UI，还是后续把 agent run 状态嵌入 work item 页面。
- retry/backoff 的第一版策略：固定次数、指数退避，还是人工批准后重跑。
