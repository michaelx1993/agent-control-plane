# Agent Control Plane Roadmap

当前可执行待办集中维护在 `todo.md`；本文保留阶段路线、完成口径和长期决策。

## 开发原则

- 先跑通闭环，再扩大自动化范围。
- Plane 只做人类任务面板，不承载高频 agent runtime。
- Plane 必须 self-host，并以未来二次开发为前提。
- Control Plane 持有调度状态、lease、run、prompt release 关联。
- 默认执行器参考 Symphony，优先使用本机已有 Codex CLI / `codex app-server` 能力，不新增付费执行平台。
- OpenHands 只作为可选 ExecutionAdapter，不进入第一版必需链路。
- Langfuse 只作为可选观测集成，不进入第一版必需链路。
- 所有付费 Cloud/SaaS/Enterprise license 必须先证明 ROI，再进入架构默认项；第一版以省钱、可控、能创造实际交付价值为优先。
- 每个阶段必须能独立验收，不能依赖“大重构完成后才可用”。

## 当前仓库状态

截至 2026-06-19，当前 `aiworkspace` 仓库处于 P0/P0.5 完成，P1/P2/P3/P4/P5/P6 最小链路分段落地，P7 多 agent/并发/基础优先级/单 run 成本门禁/持久化 dispatch budget policy 已具备最小链路，P8 生产化脚本完成最小链路，但还没有完成产品化闭环的状态。最新状态以本文为准：Langfuse 已有 run-level SDK instrumentation 骨架但默认不作为必需链路，监控阈值已支持 DB 动态配置，worker 已支持 generic/slack/email webhook 告警通知，secret env file/rotation/expiry warning、secret rotation audit log、外部 secret command、secret provider smoke、provider-side audit file/command smoke、production smoke harness、可选外部依赖只读探针、Linear migration、task-source local smoke、external preflight、completion gap report、cutover gate、本地 cutover rehearsal harness 和 completion audit 已完成本地最小链路；`codex-cli` 执行 adapter 已有最小实现和本地 smoke，completion/cutover/final audit 已改为默认 `codex-cli` profile。下一主线是用真实 Plane task / cutover report 复测 Codex-first 完成证据：Codex run events、Progress/Workpad、Plane writeback、task-source、secret provider 和 provider audit。真实 Plane/production 端到端外部 smoke、真实 task-source cutover 样本、真实 secret provider command、真实供应商账号/API 审计 smoke，以及真实完整 cutover rehearsal 仍未验收。

已完成：

- 三篇核心设计文档：PRD、ERD、Roadmap。
- P0.5 Plane self-host runbook。
- P0.5 Plane API/webhook capability matrix。
- Plane repo custom property 不可用结论和 `repo:<slug>` label fallback。
- Plane fork 已存在：`michaelx1993/plane`。
- Plane self-host 已在本机启动：`http://127.0.0.1:3200`。
- Plane PAT/API smoke test 已通过。
- Plane webhook smoke test 已通过。
- 本地 Plane client 已暴露结构化 API error 和 rate-limit retry metadata，polling sync 可按 `Retry-After` / `X-RateLimit-Reset` 退避。
- Plane webhook receiver 已支持验签、issue sync 和 comment feedback 摄取。
- worker completion 已支持回写 Plane work item state 和 summary comment。
- TypeScript monorepo 脚手架。
- `apps/` 和 `packages/` 工作区预留。
- Node 24 / pnpm 11 / TypeScript 5.9 基础约束。
- Symphony workflow polling interval 已降到 60s，降低 Linear 请求频率。
- `packages/core` 已实现状态机、角色路由、repo label 解析、派发判定和 prompt 装配。
- `packages/db` 已实现 Prisma 7 schema，并通过 `prisma validate`。
- `packages/db` 已创建 PostgreSQL migrations、`app_settings` 运行期配置表和 seed SQL。
- 已在 `agent_control_plane_migration_test` / `agent_control_plane_compat_verify` 独立测试库验证 migration + seed。
- 已补 `0004_legacy_enum_compat`，兼容旧实验库中历史 enum 缺失 `Duplicate` / `stalled` 的情况。
- 已补 `0005_app_settings`，监控告警阈值可通过 DB 动态配置覆盖 `MONITORING_*` 环境变量。
- `apps/web` 已创建 Next.js 16 控制台骨架、readiness API 和 dispatch preview API。
- `apps/web` readiness/dashboard 已可读取 PostgreSQL summary。
- `apps/worker` 已创建 worker skeleton，并可从 PostgreSQL 读取 dispatch input。
- `apps/worker` 已可事务式写入 `runs(status=claimed)` 和 `run_events(event_type=claimed)`。
- `apps/worker` 已可写入 mock `running` / `heartbeat` / `succeeded` 生命周期，并推进 task 到下一状态。
- `apps/worker` 已引入 `ExecutionAdapter` 抽象和 `mock-openhands` adapter。
- `apps/worker` 已可标记 stalled run，并对 retryable failure 做 backoff。
- `apps/web` 已提供 operator run 查询 API：`GET /api/runs`，支持 status、repository、role、task identifier 和 limit 过滤。
- `apps/web` 已提供 run detail API/UI：`GET /api/runs/[runId]` 和 `/runs/[runId]`。
- `apps/web` 已提供 run list UI：`/runs`，支持按 status、repo、role、task identifier 和 limit 筛选。
- `packages/db` 已实现 prompt release 生成和查询服务。
- `apps/worker` 已在执行前生成不可变 prompt release，并把 rendered prompt 注入 adapter。
- `apps/web` 已提供 prompt release 查询 API：`GET /api/prompt-releases`。
- `apps/web` 已提供 prompt release detail API/UI：`GET /api/prompt-releases/[releaseId]` 和 `/prompt-releases/[releaseId]`。
- `apps/web` 已提供 Prompt Manager 最小 API/UI：`/api/prompt-components`、`/api/prompt-components/[componentId]/metrics`、`/prompt-components` 和 `/prompt-components/[componentId]`。
- `apps/web` 已提供 Project Settings / Prompt Binding 最小 API/UI：`/api/settings`、settings 新增/更新/归档 APIs、`/api/prompt-bindings`、`/api/prompt-bindings/[bindingId]/status` 和 `/settings`。
- `apps/worker` 已提供 `openhands-cloud` adapter，可调用 OpenHands Cloud V1 REST API 创建 conversation、轮询 start task、轮询 execution terminal。
- `apps/worker` 已可保存 adapter 返回的 `conversation_refs`。
- `apps/worker` 已可保存 adapter 返回的 `trace_refs`，并汇总 token/cost 到 `runs`；OpenHands Cloud adapter 可从 conversation payload 和 event/message payload 中提取外部 trace ref。
- `apps/worker` 已可选启用 Langfuse SDK tracing，为每次 run 创建 `agent-run` observation，并把 Langfuse trace id 写回 `trace_refs`。
- `apps/web` run detail 已可展示 prompt release、conversation ref、trace ref、events 和 token/cost 摘要。
- `apps/web` 已提供 Task Queue API/UI：`GET /api/tasks`、`/tasks`、`GET /api/tasks/[taskId]`、`/tasks/[taskId]`。
- `apps/web` 已提供人工 gate 状态转移 API：`POST /api/tasks/[taskId]/transition`。
- `POST /api/tasks/[taskId]/rework` 已支持写入 feedback 并把允许返工的任务退回 Development。
- Worker 已写入任务级 `agent_progress` workpad，`/tasks/[taskId]` 已单独展示 Progress / Workpad。
- `POST /api/tasks/[taskId]/feedback` 已支持摄取 PR review feedback，并可选 `requestRework=true` 打回 Development。
- `/tasks` 和 `/tasks/[taskId]` 已展示 latest/active run 的 attempt、lease owner、lease expiry、heartbeat、retryable 和 retry-after，operator 可判断 agent 是否接单、是否仍在续租、失败何时重试。
- Dashboard/readiness summary 已扩展基础运行监控指标：首页 `运行监控` 展示 agent queue、active runs、human gates、blocked/stalled、retry backlog、24h success rate、failed runs、token、cost、基础告警、当前告警阈值和 12h/24h/7d 可切换趋势图。
- `/settings` 和 `/api/monitoring/thresholds` 已支持监控阈值 UI/API 动态配置，写入 `app_settings` 并记录 audit event。
- Worker 已支持 `MONITORING_ALERT_WEBHOOK_URL` 告警通知最小链路，并用 `MONITORING_ALERT_MIN_INTERVAL_MS` 对重复 fingerprint 节流；`MONITORING_ALERT_FORMAT=slack` 时输出 Slack Block Kit payload，`MONITORING_ALERT_FORMAT=email` 时输出 subject/text/html 邮件 payload；发送失败会进入 `monitoring_alert_notifications`，后续 worker 轮询优先重放。
- `ACP_OPERATOR_API_TOKEN` 可选保护 operator APIs；配置后除 readiness、Plane webhook 和 auth login/logout 外，所有 `/api/*` 请求必须带 operator token 或有效 signed session cookie；`CONTROL_PLANE_API_TOKEN` 保留为旧变量 fallback。
- Worker 长运行 loop 已支持 adapter 执行期间自动续租和 `SIGINT` / `SIGTERM` graceful shutdown。
- OpenHands terminal status 已有本地 completion/retry/block 映射，覆盖常见大小写/同义状态；adapter throw、API error 和 timeout 会写入 `openhands.adapter_error` 并进入 retryable failed。
- `scripts/release-image.sh`、`scripts/deploy-compose.sh`、`scripts/rollback-compose.sh` 已提供镜像发布、Compose 部署和应用镜像回滚最小链路。
- `scripts/db-backup.sh`、`scripts/db-restore.sh` 已提供 PostgreSQL 备份/恢复最小链路，恢复需要显式 `CONFIRM_RESTORE`。
- 已验证 `Development -> Code Review -> Human Review` 的本地数据库状态推进。
- 已用 `pnpm worker:workflow-smoke` 验证本地 mock 全链路可从 `Development` 经人工 gate、merge、release、deployment 进入 `Done`。
- 已验证 Human Review 打回 Development 后，下一次 Development prompt release 注入 unresolved feedback。
- 本仓库 Web dev server 默认监听 `http://127.0.0.1:3112`，避免和旧 3102 进程冲突。
- 根级 `format` / `check` / `build` 可运行。

未完成：

- Worker 进程和 `.env.example` 已默认使用 `WORKER_EXECUTION_ADAPTER=codex-cli`；`mock-openhands` 不再是默认运行路径，只保留给显式 smoke/legacy contract。
- `codex-cli` adapter 已有第一阶段 `codex exec --json` 实现、单测和本地 smoke；`codex-app-server` adapter 已补齐第一阶段 thread/turn 生命周期、previous thread resume、Worker loop adapter 复用和 persistent session，本机 fake 与真实 Codex follow-up 已验证，真实 Plane 派发路径下的跨 turn 长会话复用仍待验收。
- Codex event stream 到 `run_events` / Progress / Workpad / Run Detail 的第一阶段摘要已完成；生产级事件分类、截断策略和噪声过滤仍需用真实 Codex 长任务校准。
- `completion:final`、`completion:audit`、`external:preflight` 和 cutover 相关脚本已支持 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 默认 profile；OpenHands/Langfuse 保留为 legacy/optional evidence。
- 正式数据库迁移部署。
- 生产部署、镜像发布、应用镜像回滚、数据库备份/恢复策略已完成最小脚本；首页监控 dashboard 已有 queue length、run success rate、token/cost、stalled runs、retry backlog、基础告警、阈值 UI/API 动态配置、generic/slack/email webhook 告警通知、告警失败重放队列、secret validate gate、secret env file/rotation/expiry warning 最小链路、secret rotation audit log、外部 secret command 接入、secret provider smoke、provider-side audit file/command smoke、production smoke harness、可选外部依赖只读探针、趋势图和多 repo 公平队列本地 smoke；真实端到端外部 smoke、真实 secret provider command、真实 provider audit 和生产数据下的公平队列调优仍未完成。
- provider-side audit file/command smoke 已完成；真实供应商账号/API 下拉取审计事件并跑通 smoke 仍未验收。
- 从 Linear/Symphony 到 Plane/Control Plane 的真实迁移执行与真实完整 cutover rehearsal 未完成；迁移脚本、cutover gate、本地 mock rehearsal harness 和 `task-source` smoke 已有最小链路；“新任务只从 Plane/Control Plane 派发”的验收口径已写入状态页和生产 runbook。
- `pnpm external:preflight` 已完成，用于真实外部 smoke 前检查变量、关键布尔开关和最终 cutover 口径；它不执行真实写入，也不替代真实 smoke。`ACP_SECRET_ENV_FILE` 按 dotenv 安全解析，不会当作 shell 脚本 source，并会拒绝 `$(...)` / 反引号命令替换；真实供应商 CLI 只能放在 `ACP_SECRET_COMMAND` / `SECRET_PROVIDER_AUDIT_COMMAND`。预检会拒绝最终 env 模板残留的 `<...>`、`owner/repo`、`example.com` 和 `YYYY-MM-DD` 占位符，以及外部 smoke URL 指向 `localhost`、`127/8`、`0.0.0.0` 或 `::1`。预检 JSON report 的 nextCommands 会保留分项 smoke 命令，并在显式设置 `ACP_SECRET_ENV_FILE` 时让 external preflight/gap/final 命令沿用该路径。最终 cutover 设置 `ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT=true` 后，cutover report 会记录 `ready_count` / `missing_count`，completion audit 会复核 `ready_count=9` 且 `missing_count=0`。
- `pnpm completion:gap` 已完成，用于把当前环境的 external preflight 缺口写成可归档 JSON，并在终端输出每个验收 scope 的 ready/missing 摘要；`pnpm completion:doctor` 已完成，用于在不打印 secret 的前提下汇总 final env 状态、manual/auto-bound 缺口、关键 URL/manual 变量状态和本机只读探针；它们不会改变完成判定，也不会让缺配置的环境通过最终门禁。
- `pnpm completion:final-env-template` 已完成，用于生成最终 cutover dotenv 模板；它会预填最终门禁必须保持的关键开关，并以 `0600` 权限写文件，降低正式执行 `completion:final` 前漏配风险。模板不写入 shell command substitution 表达式，也不写入空的 final/report 绑定变量；原样执行 `external:preflight` 会失败，必须替换真实资源、secret provider 和人工 evidence。
- `pnpm completion:audit` 已完成，用于审计真实 cutover JSON report，并拒绝缺 smoke flag、缺 gate、错误配置、warning report、本地 localhost evidence、模板样例 evidence 和 `cutover-rehearsal mock` 证据；`pnpm completion:final` 已完成，用于一键执行 `external:preflight -> cutover:check -> completion:audit` 最终门禁。最终包装器会生成本次 final run id、绑定 cutover/audit report、拒绝 audit report 路径错配、拒绝覆盖旧 report、拒绝 allow/skip/overwrite 调试开关；默认 `codex-cli` profile 要求 Plane、Codex adapter、task-source、secret provider、provider audit 和 worker crash/budget/workflow 证据，OpenHands/Langfuse 真实行为只在 legacy/optional profile 下强制。

当前结论：

- 按本地开发口径，P0-P8 的最小代码链路、脚本门禁和 mock cutover rehearsal 已经具备闭环证据。
- 按产品闭环口径，还不能替代 Symphony：默认完成门禁已切到 `codex-cli`，但真实 Plane + Codex Worker 端到端证据仍缺。
- 下一步主线是用真实 Plane task 验证默认 `WORKER_EXECUTION_ADAPTER=codex-cli`，并按需切到 `WORKER_EXECUTION_ADAPTER=codex-app-server` 校准 Symphony-style app-server adapter；真实 cutover report 需要在 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 下通过最终审计。OpenHands/Langfuse 已不再是默认必需 evidence。
- OpenHands 和 Langfuse 后续只作为可选 adapter/observability plugin；没有可选集成账号或付费账号时，不阻断第一版完成。

## 当前验收总表

| 领域           | 当前状态                                                                                                                                                                                                             | 已验证方式                                                                                   | 未完成验收                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Plane 任务层   | 本地 API/webhook/label fallback/回写骨架和 Plane writeback smoke harness 完成                                                                                                                                        | Plane PAT/API smoke、webhook smoke、本地单元测试、mock Plane writeback smoke                 | 真实人工 gate/rework 回写复测                                                             |
| Runtime/Worker | claim、lease、heartbeat、续租、retry/backoff、stalled、lease 过期后重新派发、Task Queue 筛选、repo/role/agent 并发门禁、基础 priority 排序和单 run 成本门禁完成                                                      | DB 单元测试、本地 mock worker 状态推进、`pnpm worker:lease-smoke`、`pnpm worker:crash-smoke` | 真实 Codex adapter 长任务、workspace 残留恢复、Plane writeback 联调                       |
| Prompt 平台    | component、binding、approval、release、rollback、audit 完成                                                                                                                                                          | 单元测试、Prompt Manager/API smoke                                                           | prompt 变更质量评估和更细粒度回滚体验                                                     |
| Codex 执行器   | Symphony 执行模型已沉淀，Worker adapter 抽象、workspace manager、第一阶段 `codex exec --json` adapter 和第一阶段 `codex-app-server` adapter 已具备                                                                   | 设计文档、本地 workspace/worker smoke、`codex:adapter-smoke`、`codex:app-server-smoke`       | 真实 Plane task 端到端、真实 app-server 长会话复用、Codex-first cutover profile           |
| 可选集成       | OpenHands adapter 骨架、Langfuse trace 骨架、payload/trace smoke harness 已有                                                                                                                                        | adapter/telemetry 单元测试、本地 smoke                                                       | 仅在未来需要时接真实 OpenHands/Langfuse，不作为第一版必需条件                             |
| 监控告警       | dashboard、阈值 DB 配置、webhook 通知、失败重放、趋势图完成                                                                                                                                                          | 单元测试、本地构建                                                                           | 真实告警通道生产 smoke                                                                    |
| Secret/部署    | validate、rotate、expiry warning、rotation audit log、external command、provider smoke、provider audit file/command smoke、external preflight、completion gap report、deploy/smoke/cutover/completion audit 脚本完成 | 本地脚本 smoke、失败分支验证                                                                 | 真实 secret provider command、真实供应商账号/API 审计 smoke、真实 cutover report 审计通过 |
| Linear 迁移    | export -> Plane migration CLI 和 cutover gate 完成                                                                                                                                                                   | dry-run/缺参失败分支验证                                                                     | 真实 Linear export 迁移与切换演练                                                         |

当前“开发完成”的口径只等于：本地 mock、脚本和单元测试链路可验证。当前“产品闭环完成”的口径必须额外满足：

1. 真实 Plane task 由 Worker 使用 `codex-cli` adapter 跑通一条 Development run。
2. Control Plane run detail 能看到 Codex run events、Progress、Workpad、prompt release、workspace 和最终 summary。
3. Plane 人工 gate/rework 状态和 comment 回写在 self-host 环境复测通过。
4. `pnpm smoke:production` 在目标部署环境通过。
5. 真实 task-source 样本证明新任务只从 Plane/Control Plane 派发，且有 task/run/progress/workpad 证据。
6. 真实 secret provider command 和 provider audit smoke 通过。
7. `pnpm completion:final` 或分步 `cutover:check -> completion:audit` 在 `codex-cli` profile 下通过，并保留 `ACP_CUTOVER_REPORT_FILE`。

本地回归命令：

```bash
pnpm format
git diff --check
pnpm check
pnpm build
```

## 2026-06-19 开发完成度快照

当前可以按“本地 mock 可闭环、真实外部系统待验收”理解：

- Plane 层：self-host、API smoke、webhook smoke、repo label fallback、任务同步、comment feedback 摄取、worker completion 写回骨架、人工 gate/rework API 回写骨架和带写后回读验证的 Plane writeback smoke harness 已完成；人工 gate 后的真实 Plane smoke 仍需复测。
- Runtime 层：dispatch、claim、lease 防重复、heartbeat、lease 自动续租、长运行 loop、graceful shutdown、stalled、lease 过期后重新派发、retry/backoff、non-retryable blocked、run list/detail、Task Queue lease/retry 最小可视化、repo/role/agent 并发门禁、基础 priority 排序、单 run 成本门禁和持久化 dispatch budget policy 已完成；本地 `pnpm worker:lease-smoke` 已验证延迟 mock adapter 执行期间多次 heartbeat/lease renewal，`pnpm worker:crash-smoke` 已验证过期 running run 会 stalled 后以 attempt=2 重新认领；真实 Codex 长任务进程崩溃和 workspace 残留恢复仍待验收。
- Prompt 层：Prompt Component CRUD、diff、activate/rollback、Binding pending/approval/RBAC/audit、Release 快照、版本指标、基础审计筛选、高级审计视图、DB-backed operator user、operator signed session 最小登录态、session 管理页面、用户管理界面（含 owner/admin 创建和更新）和细粒度页面/API 权限已完成。
- Workspace 层：repository `local_path` 优先，否则 `WORKER_WORKSPACE_ROOT/<repo>/<runId>` ephemeral workspace 已完成；`WORKER_WORKSPACE_STRATEGY=git-worktree` 可为每个 run 从 repository `local_path` 创建隔离 git worktree；`pnpm worker:workspace-smoke` 已验证 worker run 会创建 per-run worktree、写入 `workspace.ready` 并把 workspace context 注入 adapter；过期 ephemeral / git-worktree workspace 清理 CLI 已完成，git-worktree 会优先执行 `git worktree remove --force` 和 `git worktree prune`；远程 sandbox 未完成。
- OpenHands 层：`mock-openhands` adapter、`openhands-cloud` REST adapter、conversation ref、adapter event 摘要写入 `run_events`、conversation payload 事件摘要提取、同源 event log URL 拉取、可配置 event API path fallback、LLM generation 事件摘要、嵌套 LLM chat payload prompt/output 摘要、payload trace ref 提取、OpenHands conversation smoke harness、adapter-level smoke CLI 和常见 list response 形态兼容已完成；OpenHands 真实端到端、细粒度 event API payload 校准、真实 UI 跳转属于 optional/legacy profile，未完成也不阻断 Codex-first 闭环。
- Langfuse 层：adapter trace ref、OpenHands payload trace ref 提取、run token/cost 汇总、run-level SDK instrumentation 骨架、rendered prompt/result output 记录、OpenHands LLM 摘要并入 run output 和 SDK trace smoke harness 已完成；真实 trace UI smoke、OpenHands 内部逐 LLM call 与真实 trace 深度关联属于 optional/legacy profile，未完成也不阻断 Codex-first 闭环。
- 部署层：Dockerfile、Compose、CI release gate、镜像发布脚本、Compose 部署脚本、应用镜像回滚脚本、数据库备份/恢复脚本、首页监控 dashboard 最小指标、基础告警、阈值 UI/API 动态配置、generic/slack/email webhook 告警通知、告警失败重放队列、secret validate gate、secret env file/rotation/expiry warning 最小链路、secret rotation audit log、外部 secret command 接入、secret provider smoke、provider audit file/command smoke、production smoke harness、可选外部依赖只读探针、cutover gate 和趋势图已完成；真实端到端外部 smoke、真实 secret provider command 和真实 provider audit 仍未完成。
- 本地验收层：2026-06-20 已通过 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=false pnpm completion:local-smoke`，该命令聚合 `git diff --check`、脚本语法检查、`pnpm check`、`pnpm db:validate`、`pnpm secrets:validate`、Core/DB/Plane/Worker build、`operator:query-smoke`、`linear:migrate-smoke`、`plane:human-gate-writeback-smoke`、`codex:adapter-smoke`、`codex:app-server-smoke`、`worker:codex-smoke`、`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true pnpm worker:codex-smoke`、`worker:codex-plane-smoke` 默认安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server pnpm worker:codex-plane-smoke` 安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm worker:codex-plane-smoke` 安全 skip、`openhands:payload-contract`、OpenHands payload capture rehearsal、`task-source:local-smoke`、`worker:fairness-smoke`、`worker:workspace-smoke`、`worker:lease-smoke`、`worker:crash-smoke`、`worker:budget-smoke`、`worker:workflow-smoke`、`workspace:cleanup-smoke`、`cutover:report-smoke`、`external:preflight-smoke`、`completion:doctor-smoke`、`completion:gap-smoke`、`completion:final-env-template-smoke`、`completion:audit-smoke`、`completion:final-smoke`、`completion:local-web-build-smoke`、`cutover:codex-rehearsal` 和 `cutover:rehearsal`；`operator:query-smoke` 会在临时 PostgreSQL 数据库上执行真实 operator task/run 查询，覆盖 enum/text 兼容问题；`codex:app-server-smoke` 会用 fake app-server 验证 Codex app-server JSON-RPC 生命周期和事件落库前摘要转换；Web production build 默认 auto：无 Next dev lock 时自动纳入验收；有 lock 时跳过并输出持锁 PID；瞬时 Next build lock retry 行为已有独立 smoke 覆盖。
- 完成审计层：默认 `codex-cli` 的 `completion:audit` 已要求任务来源 evidence 覆盖每一条 checked 任务，不能用少量 run、Codex run event 或 Progress / Workpad 证据覆盖多条 Plane task；OpenHands conversation 和 Langfuse trace 只属于 legacy/optional profile。模板占位拒绝已覆盖 URL 和 run id、task id、provider、preflight id、日期等标量 evidence 字段；本地 `completion:audit-smoke` 和 `completion:local-smoke` 已覆盖这些失败分支。

验收口径：

- “开发完”只代表本地 mock 和单元测试链路可验证。
- “产品闭环完成”必须同时满足真实 Codex Worker run、Control Plane run events / Progress / Workpad、Plane 人工 gate 回写、生产 smoke、secret provider、provider audit、task-source 迁移证据和 `completion:final` 生成的真实 cutover report 通过审计。

下一轮必须优先验收：

1. 用真实 Plane test task 验证默认 `WORKER_EXECUTION_ADAPTER=codex-cli` 第一阶段执行链路，并按需要切到 `WORKER_EXECUTION_ADAPTER=codex-app-server` 校准 app-server 长会话模式。
2. 用真实 Codex event stream 校准 `run_events` 摘要流和任务级 Progress / Workpad 的分类、截断与噪声过滤。
3. 用真实 cutover report 复测默认 `codex-cli` completion/cutover profile，让 Codex run events、Progress/Workpad、Plane writeback、task-source、secret provider 和 provider audit 组成完成证据；OpenHands/Langfuse 只在 optional/legacy profile 下参与。
4. 设置 `PLANE_WRITEBACK_SMOKE_APPLY=true` 和 `PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID`，在真实 Plane test work item 上执行 `pnpm plane:writeback-smoke`。
5. 设置 `PLANE_WRITEBACK_ENABLED=true`，从 `/tasks/[taskId]` 执行人工 gate 通过和打回，复测 Plane 状态/评论回写。
6. 用真实 Codex 长任务复测 worker loop、lease 自动续租、graceful shutdown 和崩溃恢复。
7. 配置真实 secret provider command 和 provider audit 输入，在 `codex-cli` profile 下执行 `pnpm completion:final`，保留 `reports/cutover-<final-run-id>.json` 作为最终完成证据。

## 技术栈决策

第一版采用：

- Language: TypeScript。
- Runtime: Node 24。
- Package manager: pnpm 11。
- Monorepo: pnpm workspace。
- Web: Next.js，放在 `apps/web`。
- Worker: Node.js long-running worker，放在 `apps/worker`。
- Shared packages: `packages/*`。
- Database: PostgreSQL。
- ORM/migration: Prisma 优先。
- Tests: Vitest。
- Formatting: Prettier。

选择理由：

- 用户界面、API route、后台 worker 都能共享 TypeScript 类型。
- Prisma schema 对 ERD 落地直观，migration 容易审查。
- PostgreSQL 从第一天承载 lease、并发、状态机和审计，不需要 SQLite 迁移债。
- Next.js 足够覆盖个人控制台和 operator API，避免一开始拆太多服务。
- Worker 独立于 Web 进程，防止长任务阻塞 UI/API。

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

## P0 方案固化

目标：把产品边界、数据模型、状态机和集成边界定死。

状态：基本完成，后续随实现保持文档同步。

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
- `packages/core`
- `packages/db`

验收标准：

- 明确 Plane / Control Plane / OpenHands / Langfuse 各自职责。
- 明确 task 必须指定 repo。
- 明确 prompt 装配顺序。
- 明确哪些状态自动执行，哪些状态人工判定。
- 状态机、repo 路由和 prompt 装配有单元测试覆盖。
- Prisma schema 和 ERD 同步，并可通过 `prisma validate`。

## P0.5 Plane Self-host Spike

目标：验证 Plane self-host、API、webhook、字段扩展和二开入口，不在假设上启动 P1。

状态：完成。custom property 在当前 Plane v1.3.1 Community self-host 不可用，P1 使用 `repo:<slug>` label fallback。

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
- 验证 repo 字段：当前用 label `repo:<name>`，未来二开字段替换。
- fork `makeplane/plane` 到 `michaelx1993`，确认后续二开路径。

交付物：

- Plane self-host runbook。
- Plane API/webhook capability matrix。
- Repo 字段方案结论。
- Plane fork 仓库。

当前交付状态：

- `docs/plane-self-host-runbook.md` 已创建。
- `docs/plane-capability-matrix.md` 已创建。
- `michaelx1993/plane` fork 已确认存在。
- 本机 Plane 已启动在 `http://127.0.0.1:3200`。
- PAT/API smoke test 已完成。
- Webhook smoke test 已完成。
- repo custom property 已验证不可用。
- `repo:<slug>` label fallback 已完成 API 创建、绑定和读取验证。

验收标准：

- Plane 可 self-host 启动并登录。
- Control Plane 能通过 API 拉取 project/task。
- Plane task 状态和 repo label 能被读取。
- Plane webhook 能触发本地 receiver，或明确需要 polling fallback。
- 明确第一阶段是否需要改 Plane 源码。

当前验收结果：

- self-host 启动、HTTP 200、容器运行已验证。
- API 拉取 project/states/work-items 已验证。
- API 更新 work item 和创建 comment 已验证。
- webhook issue update 和 issue_comment create 已验证。
- repo custom property 在当前版本不可用。
- label fallback 已验证可用。

风险：

- Plane 原生 custom field 能力不足，后续需要二开一等 repo 字段。
- webhook 不完整时，P1 必须保留 polling fallback。

## P1 Plane 任务层接入

目标：用 self-host Plane 替代 Linear 作为任务和人工 review 面板。

状态：核心闭环已落地。Plane API client、label/state/work item 拉取、work item 到本地 task upsert、webhook receiver、comment feedback 摄取、comment list polling fallback、Plane polling 全局 API retry、comment polling 部分失败降级、Plane sync warning/failure webhook、project cursor 级增量 upsert、可选 Plane 服务端 `updated_after` 查询、worker 完成后状态和 summary comment 回写已完成；真实 Plane 版本的 `updated_after` 能力和更完整的生产化异常处理仍需验证。

模块：

- Plane API client
- Plane webhook receiver
- Plane polling fallback
- Team/project/task 同步
- Task 状态映射
- Repo 字段/label 解析

关键能力：

- 从 Plane 拉取 label/state/work item。
- 接收 Plane task create/update webhook。
- 接收 Plane issue comment webhook 并写入 `feedback_items`。
- 通过 `pnpm plane:sync` polling fallback 拉取 Plane comments，并幂等写入 `feedback_items`。
- Plane polling 默认对 labels/states/work items/comments 的 429、5xx、408 和网络类失败重试 3 次、基础延迟 1000ms，可用 `PLANE_SYNC_RETRY_ATTEMPTS` / `PLANE_SYNC_RETRY_DELAY_MS` 覆盖；`Retry-After` / `X-RateLimit-Reset` 会优先于基础延迟，401/403/404 等非重试型 4xx 不盲重试；全局 API 最终失败仍让本轮失败退出，避免写入半可信快照。
- 设置 `PLANE_SYNC_SERVER_DELTA=true` 后，`pnpm plane:sync` 会把当前 project cursor 作为 `updated_after` 传给 Plane work item list API；若目标 Plane 返回明显不支持该参数的 400/unknown/invalid 错误，会自动回退全量 polling。server delta 只用于 task upsert 列表，comment polling 仍扫描全量 work item id 并按 comment cursor 过滤，避免旧 work item 的新 comment 因 issue `updated_at` 未变化而漏读。
- 单个 work item comment 拉取失败时，`pnpm plane:sync` 会记录 `commentFetchWarnings`，继续同步其他 task/comment，并暂停推进 project cursor，避免漏掉失败 work item 的新评论。
- 配置 `MONITORING_ALERT_WEBHOOK_URL` 后，`pnpm plane:sync` 会在 `commentFetchWarnings > 0` 时发送 warning webhook，在全局 sync failure 时发送 critical webhook。
- `pnpm plane:sync` 会读取 `app_settings(plane.sync_cursor.<projectSlug>)`，只 upsert cursor 之后变更的 task/comment；无 comment fetch warning 时同步成功后推进 project cursor。
- 将 Plane task 映射成本地 `tasks`。
- 解析 repo：当前使用 label，例如 `repo:crs-src`。
- 同步状态变更回 Plane。
- run 完成后向 Plane 写入 summary comment。

交付物：

- `packages/plane`
- `pnpm plane:sync`
- `/api/plane/webhook`
- `task_sync_service`
- `state_mapping`
- `feedback_items` polling fallback
- `plane.sync_cursor.<projectSlug>` app setting
- `commentFetchWarnings` summary
- `PLANE_SYNC_RETRY_ATTEMPTS` / `PLANE_SYNC_RETRY_DELAY_MS`
- `PLANE_SYNC_SERVER_DELTA`
- Plane sync warning/failure webhook
- `plane_writeback`

验收标准：

- 创建 Plane task 并绑定 `repo:<slug>` label 后，本地能同步出 task。
- task 没有 repo 时，不会进入可派发队列。
- 修改 Plane 状态后，本地 task 状态能更新。
- 新增 Plane comment 后，本地能写入 `feedback_items`。
- Plane 临时 API 失败会按配置重试；全局 API 在 retry 后成功时本轮继续完成。
- `commentFetchWarnings > 0` 或全局 sync failure 时，配置 webhook 的环境能收到 Plane sync warning/critical payload。
- 已存在 sync cursor 时，`pnpm plane:sync` 只 upsert cursor 之后变更的 task/comment，并在成功后推进 cursor。
- 单个 work item comment 拉取失败时，task sync 不整体失败，summary 会返回 `commentFetchWarnings`，并且本轮不推进 cursor。
- 本地 run 完成后，能把状态和摘要写回 Plane。

风险：

- Plane API/webhook 能力需要实测。
- `PLANE_SYNC_SERVER_DELTA=true` 可减少 task upsert 使用的服务端返回量，但真实 Plane 版本是否支持 `updated_after`、分页/过滤语义是否稳定仍需环境验证；默认关闭是为了保守上线。旧 issue 新 comment 的防漏读已通过本地契约覆盖：comment polling 不依赖 delta 结果。
- comment polling 部分失败会冻结 cursor，避免漏数据，但会让下一轮重扫 cursor 之后的已成功 task/comment。
- Plane 原生自定义字段当前不足，已先用 label 承载；未来进入 Plane fork 二开。

## P2 Control Plane Runtime

目标：建立自己的 agent runtime 状态库，替代把 runtime 写进 Plane comments。

状态：基础闭环已完成。长运行 loop、lease 自动续租、lease 过期后重新派发和 graceful shutdown 已完成最小实现；Task Queue 已可展示 active lease、heartbeat、attempt、retryable 和 retry-after，并支持 lease/retry 深度筛选；worker dispatch snapshot 只读取自动状态，避免 Backlog / human gate / terminal task 污染 claim 顺序；首页监控已展示 retry backlog、基础告警、当前阈值和趋势图；`/settings` 和 `GET/PUT /api/monitoring/thresholds` 已可动态调整阈值；worker 已支持 generic/slack/email webhook 告警通知、重复 fingerprint 节流和失败重放队列；本地 `pnpm worker:crash-smoke` 已验证 mock 崩溃恢复，`pnpm worker:fairness-smoke` 已验证多 repo `repo_fair` 轮转；真实 Codex 长任务进程崩溃和 workspace 残留恢复验收仍未完成。

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
- 失败后按策略 retry。
- 对外提供 run 查询 API。

已完成：

- 从 PostgreSQL 查询 dispatch input。
- 判断可派发任务并按 role claim。
- 写入 `runs.status = claimed`。
- 写入 `run_events.event_type = claimed`。
- active lease 防重复认领。
- 写入 `running`、`heartbeat`、`succeeded` 生命周期。
- mock completion 后按 role 默认下一状态推进 task。
- worker execution adapter 抽象。
- `mock-openhands` adapter。
- stalled run 检测，超时 run 标记为 `stalled` 并写 `run_events`。
- retry/backoff：retryable failed/stalled run 在 backoff 窗口内不会重新派发。
- non-retryable failure 会把 task 标记为 `Blocked`。
- operator run 查询 API：`GET /api/runs?status=&repository=&role=&task=&limit=`。
- Task Queue / detail 页面已展示 latest/active run 的 attempt、lease owner、lease expiry、heartbeat、retryable 和 retry-after。
- `GET /api/tasks` 和 `/tasks` 已支持 `lease=active|none|expired` 与 `retry=retryable|waiting|ready|blocked` 深度筛选。
- `WORKER_RUN_LOOP=true` 时 worker 会按 `WORKER_LOOP_INTERVAL_MS` 长运行轮询。
- adapter 执行期间 worker 会按 `WORKER_LEASE_RENEWAL_INTERVAL_MS` 写 heartbeat 并刷新 `lease_expires_at`。
- CLI 已支持 `SIGINT` / `SIGTERM` graceful shutdown：停止下一轮轮询，当前 `runOnce` 完成后退出。
- `pnpm worker:lease-smoke` 会默认创建临时数据库、迁移、seed，并用延迟 `mock-openhands` 验证长任务期间至少写入两个 heartbeat 事件。
- `pnpm worker:crash-smoke` 会默认创建临时数据库、迁移、seed，插入过期 running run，并验证旧 run 被标记为 stalled、同一任务以 attempt=2 重新认领后推进到 Code Review。

未完成：

- 真实 Codex 长任务续租、进程崩溃和 workspace 残留恢复验收。

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
- heartbeat 超时可标记 stalled。
- run 状态变化不依赖 Plane comment。

当前验收结果：

- 已验证同一 task 有 active lease 时不会重复 claim。
- 已验证 worker 可写入 claimed/running/heartbeat/succeeded 事件。
- 已验证 mock completion 可推进 `Development -> Code Review -> Human Review`。
- 已验证过期 run 会被标记为 `stalled`。
- 已用单元测试覆盖 retry/backoff 查询与 non-retryable failure blocked 策略。
- 已用单元测试覆盖 lease renewal 配置和 heartbeat 刷新 `lease_expires_at`。
- 已用 DB 单元测试覆盖 Task Queue latest run 的 attempt、lease、retryable、retry-after 映射，以及 lease/retry 深度筛选参数。
- 已用 `pnpm worker:lease-smoke` 验证本地 mock 长任务执行期间会多次 heartbeat/续租，并清理临时数据库。
- 已用 `pnpm worker:crash-smoke` 验证本地 mock 崩溃恢复：过期 running run 会被标记 stalled，同一任务以 attempt=2 重新认领，并清理临时数据库。
- 尚未验证真实 Codex 长任务续租、进程崩溃与 workspace 残留恢复。

风险：

- stalled threshold 过短会误判长任务失败。
- lease 过长会导致崩溃恢复慢。

## P3 Prompt 平台化

目标：prompt 从 GitHub 文件迁移到平台管理。

状态：最小执行闭环已落地。Prompt Component CRUD、diff、rollback 最小 UI 已完成；Prompt Binding 管理、最小审批态、operator role 门禁、最近审计视图、基础审计筛选、高级审计视图、DB-backed operator user、operator signed session 最小登录态、session 管理页面、用户管理界面（含 owner/admin 创建和更新）和细粒度页面/API 权限已完成。

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
- 每次 run 前生成不可变 prompt release。
- 记录 prompt release 组成和 hash。
- 支持回滚 active prompt。

已完成：

- Seed 中已有 team / repo / role 三类 prompt component。
- Seed 中已有 active prompt binding。
- `packages/core` 已提供 prompt renderer。
- `packages/db` 已提供 `createPromptReleaseForRun`，按 run 读取 task/repo/role/agent/team/project 上下文并生成 rendered prompt。
- `prompt_releases.content_hash` 使用 SHA-256 记录最终 prompt hash。
- `prompt_release_components` 记录组件顺序和组件 hash。
- `runs.prompt_release_id` 会绑定本次 run 实际使用的 prompt release。
- prompt 中会注入 task context、unresolved feedback 和 runtime constraints。
- Worker 在 adapter 执行前生成 prompt release，并传入 `promptReleaseId` / `renderedPrompt`。
- `GET /api/prompt-releases?limit=` 可查询最近 prompt release。
- `GET /api/prompt-releases/[releaseId]` 和 `/prompt-releases/[releaseId]` 可查看 rendered prompt、component 明细、关联 runs。
- `GET/POST /api/prompt-components` 可查询和创建 prompt component version。
- `GET /api/prompt-components/[componentId]` 可查看 component 详情和历史版本。
- `POST /api/prompt-components/[componentId]/activate` 可激活某个版本，并更新 active binding。
- `POST /api/prompt-components/[componentId]/archive` 可归档版本。
- `GET /api/prompt-components/diff?from=&to=` 可对比两个版本。
- `GET /api/prompt-components/[componentId]/metrics` 可查看该版本关联 release/run 数、成功率、token、成本和最近 runs。
- `/prompt-components` 和 `/prompt-components/[componentId]` 已提供最小 Prompt Manager UI。
- `GET /api/settings` 可读取 Project Settings 所需基础数据和 prompt bindings。
- `POST /api/settings/repositories/[repositoryId]` 可更新 repository 配置。
- repository 新增、更新、归档 API/UI 已完成。
- `POST /api/settings/roles/[roleId]` 可更新 role 配置。
- role 新增、更新、归档 API/UI 已完成。
- `POST /api/settings/agent-definitions/[agentDefinitionId]` 可更新 agent definition 配置。
- agent definition 新增、更新、归档 API/UI 已完成。
- `GET/POST /api/prompt-bindings` 可读取和创建 prompt binding；新建 binding 默认 `pending`，创建需要 `prompt_editor` / `prompt_admin` / `admin` / `owner`。
- `POST /api/prompt-bindings/[bindingId]/status` 可批准、拒绝、禁用、重新提交 prompt binding，审批操作需要 `prompt_admin` / `admin` / `owner`，并写入带 actor 的 `audit_events`。
- `/settings` 已提供 Project Settings 和 Prompt Binding 最小 UI，支持 repository、role、agent definition 的新增、编辑和归档，并展示审计事件筛选表单。
- `GET /api/audit-events` 已支持按 entity type、action、actor、时间窗口和 limit 查询审计事件，并返回 action/entity/actor 聚合摘要。
- `/audit` 已提供高级审计视图，可展示审计总量、唯一 actor、时间范围、Top action/entity/actor 和最近事件列表。
- Operator API token proxy 已完成：`ACP_OPERATOR_API_TOKEN` 配置后保护 `/api/*` operator endpoints，保留 readiness、Plane webhook 和 auth login/logout 公开，`CONTROL_PLANE_API_TOKEN` 兼容旧配置。
- DB-backed operator user 已完成最小闭环：`/login` 和 `POST /api/auth/login` 会 upsert/read `users(external_provider=local, external_user_id=<operator name>)`，session 和 audit actor 使用数据库 user id。
- Operator signed session 已完成最小闭环：`/login` 使用 `ACP_OPERATOR_LOGIN_PASSWORD` 创建 signed cookie，middleware 会保护非公开页面，`POST /api/auth/login` 支持 API 登录，`POST /api/auth/logout` 清除 session，`GET /api/auth/session` 返回当前 operator context。
- Session 管理页面已完成最小闭环：`/session` 展示当前 operator、认证方式、session 过期时间，并可退出当前浏览器 session。
- 用户管理界面已完成最小闭环：`/users` 和 `GET /api/users` 展示 DB-backed operator users，`/users` 表单和 `POST /api/users` 支持 owner/admin 创建或更新用户，并记录 `audit_events(action=user.upsert)`。
- 细粒度页面/API 权限已完成最小闭环：proxy 根据 operator roles 保护 `/users`、`/settings`、prompt 管理面和对应 mutating APIs；owner/admin 全通，prompt roles 只进入 prompt surfaces，viewer 只能访问只读观察面。

交付物：

- `prompt_components`：已建表并 seed 基线数据。
- `prompt_bindings`：已建表并 seed active binding。
- `prompt_releases`：已建表，并由 worker 执行前写入。
- `prompt_release_components`：已建表，并记录 release 组成。
- Prompt Manager UI：已完成最小 component CRUD / diff / rollback。
- Prompt version metrics：已完成最小 API/UI，按 component version 聚合 release/run/成功率/token/成本。

验收标准：

- 不改 GitHub 文件即可修改 agent prompt：最小满足，Prompt Manager 可创建 component 新版本并激活，Settings 可创建/启停 prompt binding。
- 每次 run 能看到实际使用的 prompt release：API 和详情 UI 已完成最小链路。
- 被 run 引用的 prompt release 不可变：已通过 release 快照和 component 明细实现。
- prompt 改动后只影响未来 run，不影响历史 run：由 release 快照保证；已用回归测试覆盖已绑定 run 不会重新读取 active bindings。
- 可以激活旧版本完成最小 rollback。

当前验收结果：

- 已验证 worker 执行前生成 prompt release。
- 已验证 `runs.prompt_release_id is not null`。
- 已验证 `prompt_releases.content_hash` 为 64 位十六进制 SHA-256。
- 已验证 `prompt_release_components` 写入 3 个组件。
- 已用 DB 单元测试覆盖 prompt component list/create/activate/diff。
- 已用 DB 回归测试覆盖已绑定 `prompt_release_id` 的历史 run 不会重新读取 active bindings 或创建新 release。
- Prompt Manager 和 Prompt Binding API/UI smoke 命令已记录到 `docs/agent-control-plane-db-runbook.md`。

风险：

- prompt 平台化后必须限制权限，否则 agent 行为容易被误改。
- prompt 内容可能包含敏感信息，需要审计和访问控制。

## P4 Codex-first 执行层

目标：用 Worker 默认承接 agent 执行、workspace、Codex event stream 和状态推进；第一版优先使用本机 Codex CLI，OpenHands 只作为可选 adapter。

状态：mock adapter、`codex-cli` adapter 第一阶段、`codex-app-server` adapter 第一阶段、OpenHands Cloud 可选 adapter、本机目录版 Workspace manager 和 adapter event stream 摘要同步已完成；Worker 进程和 `.env.example` 已默认使用 `WORKER_EXECUTION_ADAPTER=codex-cli`，`mock-openhands` 只保留给显式 smoke/legacy contract；`codex-cli` 当前走 `codex exec --json`，`codex-app-server` 当前走 stdio JSON-RPC 的 `initialize -> thread/start -> turn/start -> turn/completed` turn 生命周期，均已通过本地 fake smoke；Worker 已能把同一 task 的上一条同 provider `conversation_ref` 注入下一次执行，`codex-app-server` adapter 可从上一条 ref 恢复 thread id 并直接启动 follow-up turn；Worker loop 会在进程内复用同一个 execution adapter 实例，`codex-app-server` 默认开启 persistent session，让多轮 turn 共用同一个 app-server 进程，`WORKER_CODEX_APP_SERVER_PERSISTENT=false` 可退回每 turn 新进程；`codex-cli` 已通过单元测试、`pnpm codex:adapter-smoke`、DB-driven `pnpm worker:codex-smoke` 和本机真实 `worker:codex-real-smoke`，并已进入默认 completion/cutover profile；显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` 也已通过本机真实 `worker:codex-real-smoke` 单 turn Worker 链路。Worker 已把高信号 Codex/OpenHands 事件同步到任务级 Progress / Workpad；Codex stdout JSONL / plain stdout / stderr 入库前已覆盖 token、secret、password、api key 和 Bearer token 最小脱敏；常见 Codex app-server method / wrapper 事件已归一到 agent message、reasoning、exec command、file operation、plan 和 token usage 等高信号类型；尚未完成真实 Plane task 端到端、真实业务长任务事件校准，以及真实跨 turn 长会话复用。

模块：

- Codex CLI adapter
- 可选 OpenHands adapter
- Workspace manager
- Conversation manager
- Event stream consumer
- Result parser
- Execution timeout/stuck detection

关键能力：

- 根据 task/repo 创建 workspace。
- 启动 Codex CLI / Codex app-server。
- 注入 prompt release。
- 启动 agent run。
- 消费 Codex JSONL / event stream。
- 保存 conversation ref。
- 将执行结果回传 Control Plane。

已完成：

- `ExecutionAdapter` 接口。
- `mock-openhands` adapter。
- `codex-cli` adapter 第一阶段实现：执行 `codex exec --json --output-last-message ... -`，注入 rendered prompt 和 task context，解析 JSONL 输出为 `codex.*` run events，返回 `provider=codex-cli` conversation ref。
- `codex-app-server` adapter 第一阶段实现：启动 app-server，发送 `initialize` / `initialized` / `thread/start` / `turn/start`，消费 turn notifications 和 terminal event，返回 `provider=codex-app-server` conversation ref；默认参数使用 `gpt-5.5`、high reasoning、`approvalPolicy=never`、`thread sandbox=workspace-write` 和 workspaceWrite turn sandbox。
- `codex-app-server` adapter 已支持 previous conversation resume：当 Worker 注入同一 task 的上一条 `provider=codex-app-server` conversation ref，adapter 会跳过 `thread/start`、复用旧 thread id 启动 follow-up `turn/start`，并写入 `codex.thread_reused` 事件。
- Worker loop 已支持 adapter 实例复用：`runWorkerLoop()` 在循环外创建 execution adapter，多轮 poll 共享同一实例；`runOnce()` 仍可单独创建 adapter，或接收 loop 注入的 adapter。`codex-app-server` adapter 已支持 persistent session，默认复用同一个 app-server 进程处理后续 turns，失败、超时或 dispose 时关闭 session。
- `pnpm codex:adapter-smoke` 已验证 fake Codex 输出能被映射为 `codex.started`、`codex.agent_message`、`codex.completed`，并把 Development 推进到 Code Review。
- `pnpm codex:app-server-smoke` 已验证 fake Codex app-server 能跑通 initialize、thread start、turn start、agent message、command output、turn completed、conversation ref 和 Development -> Code Review。
- `pnpm worker:codex-smoke` 已验证 fake Codex 经真实 Worker `runOnce()` 和临时 DB 跑通：claim Development task、准备 git-worktree workspace、创建 prompt release、写 `workspace.ready` / `codex.*` events、写 `conversation_refs(provider=codex-cli)`、写 Running/Completed Progress，并推进到 Code Review；显式设置 `WORKER_EXECUTION_ADAPTER=codex-app-server` 时同一 smoke 会用 fake app-server 覆盖 Worker/DB/workspace 链路；再设置 `WORKER_CODEX_SMOKE_FOLLOW_UP=true` 时会用同一个 injected adapter 执行同一 task 的第二次 Code Review run，验证 `codex.thread_reused` 和同一 thread id。
- `pnpm worker:codex-real-smoke` 已作为显式 opt-in 入口落地，用本机真实 `codex exec` 跑同一条临时 DB / Worker / git-worktree 链路；默认要求 `WORKER_CODEX_REAL_SMOKE_CONFIRM=true`，并使用 `gpt-5.5` + high reasoning，在临时 workspace 中校验 marker 文件。
- 2026-06-20 已用真实 Codex 验证三条 Worker 链路：默认 `codex-cli` real smoke 产生 `run_id=8b54cdd7-eac9-4fa6-a51b-af85d14e1480`、`codex_events=16`、`marker_verified=true`、`next_state=Code Review`；显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` real smoke 产生 `run_id=87505c9e-6833-4f1f-b438-09a8b814773e`、`codex_events=104`、`marker_verified=true`、`next_state=Code Review`；显式 `WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true` follow-up real smoke 产生 `run_id=ed4078e4-f319-4fde-a4c1-e74bbc775f4b`、`follow_up_run_id=4d19ebe6-403d-4ae7-9583-bcc33024f645`、`thread_reused=true`、`marker_verified=true`。该证据仍是本机临时 DB / git-worktree smoke，不替代真实 Plane task 或 Plane writeback。
- `pnpm worker:codex-plane-smoke` 已作为显式 opt-in 入口落地，用真实 Plane work item 驱动 Codex Worker，并验证 Control Plane run、`codex.*` events、git-worktree、任务级 Running / Agent Events / Completed Progress / Workpad、状态推进和 Plane comment/state 写回；默认要求 `WORKER_CODEX_PLANE_SMOKE_APPLY=true` 和 Plane API 环境变量，默认使用 `codex-cli`，也可显式设置 `WORKER_EXECUTION_ADAPTER=codex-app-server`。设置 `WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true` 时会要求 app-server adapter，并在同一 Plane work item 上模拟 review 打回后复跑第二轮，验证第二轮 Progress / Workpad、thread reuse 和第二次 Plane writeback。
- `codex-cli` adapter 已在 stdout JSONL payload、plain stdout 和 stderr 入库前执行最小脱敏，覆盖常见 `token=`、`secret=`、`password=`、`api_key=`、GitHub token、OpenAI-style key 和 Bearer token，避免真实 agent 输出把敏感信息写入 `run_events` / Progress；同时把 `item/agentMessage/delta`、`codex/event/agent_message_delta`、reasoning、command output 和 file change 等 app-server/wrapper 事件归一为可读高信号摘要。
- worker 通过 adapter 结果执行 complete/fail。
- adapter mode 可通过 `WORKER_EXECUTION_ADAPTER` 配置。
- adapter result 已支持返回 conversation ref。
- worker 已可将 adapter 返回的 conversation ref 写入 `conversation_refs`。
- mock adapter 已可写入 `provider=mock-openhands` 的 conversation ref，供 run detail 链路验证。
- worker 已在 adapter 执行前准备 workspace，默认优先使用 repository `local_path`，否则在 `WORKER_WORKSPACE_ROOT` 下创建 ephemeral workspace；`WORKER_WORKSPACE_STRATEGY=git-worktree` 且 repository 有 `local_path` 时，会创建 per-run git worktree。
- workspace 准备会写入 `workspaces` 和 `run_events(workspace.ready)`，run detail 页面可展示 workspace strategy/path/base/head/status。
- execution adapter input 已包含 workspace path/strategy/base/head ref。
- `pnpm workspace:cleanup` 已可按 `WORKSPACE_CLEANUP_RETENTION_MS` 和 `WORKSPACE_CLEANUP_LIMIT` 查找已完成 run 的过期 ephemeral / git-worktree workspace；默认 dry-run，`WORKSPACE_CLEANUP_APPLY=true` 时清理位于 `WORKER_WORKSPACE_ROOT` 内的目录、标记 `workspaces.status=cleaned` 并写入 `run_events(workspace.cleaned)`；`pnpm workspace:cleanup-smoke` 已验证 dry-run 不删除、apply 删除并写 cleaned event。
- `git-worktree` cleanup 在 repository `local_path` 存在时会优先执行 `git worktree remove --force <workspace-path>` 和 `git worktree prune`，清掉主仓库 metadata；Git 命令失败时 fallback 到目录删除，避免坏 workspace 永久阻塞 cleanup。
- execution adapter result 已支持返回 event stream 摘要，worker 会写入 `run_events`，run detail 可展示 event payload。
- Worker 会把高信号 `codex.*` / `openhands.*` execution events 汇总成任务级 `Agent Events` Progress，过滤 started/completed 等低信号生命周期事件，并在写入前再次脱敏常见 token/secret/password/Bearer。
- mock adapter 已返回 agent message / tool call / shell 三类事件，用于本地验证执行轨迹展示。
- `openhands-cloud` adapter 已支持 V1 Cloud API：创建 conversation、轮询 start task、轮询 execution terminal、返回 conversation ref，并从 conversation payload 中的 `events` / `event_log` / `eventLog` / `messages` 提取轻量事件摘要；LLM generation 会从字符串或嵌套 chat messages / choices 中提取 prompt、input、output、response、completion 摘要，并保留 model、token、cost、latency 和 trace 字段；如果 payload 暴露同源 event log URL/URI，会额外拉取 event log 并优先用 event log 摘要；如果 payload 未暴露 URL，可用 `OPENHANDS_EVENT_LOG_PATH_TEMPLATE` 配置同源 event API fallback；拉取失败时写 warning event 并回退到 conversation payload 摘要；如果 payload 暴露 trace id，也会提取 trace refs 写入本地。本地摘要入库前会脱敏常见 API key、token、secret、password、Bearer token 和 `sk-*` key。
- `openhands-cloud` adapter 支持从 GitHub git URL 推导 `selected_repository`，也支持 `OPENHANDS_SELECTED_REPOSITORY` 覆盖。
- `openhands-cloud` adapter 已将 terminal status 映射为 Control Plane 结果：`finished/completed/succeeded -> succeeded`，等待确认/用户输入和 stuck/blocked/paused 类状态进入 non-retryable failed，sandbox error/missing/lost/unavailable/terminated 与 execution error/failed/crashed/timeout 类状态进入 retryable failed，cancelled/aborted/stopped 进入 non-retryable failed。
- worker 已捕获 adapter throw/timeout/API error，写入 `openhands.adapter_error`，并把 run 标记为 retryable failed，避免外部异常导致 run 无终态。

未完成：

- 用真实 Plane task + 真实 repo 跑通 Codex Development run，并回写 Plane 状态/comment。
- 用真实 Plane task 或真实业务长任务校准 Progress / Workpad / Run Detail 的事件分类、截断策略和噪声过滤。
- 真实 Plane task 路径下的 `codex app-server/thread/turn` 跨 turn 长会话复用验收，复刻 Symphony 的低启动开销执行链路。
- 真实长任务 stuck/timeout 策略调优。

交付物：

- `codex_cli_adapter`
- `codex_app_server_adapter`
- `openhands_adapter`（可选）
- `conversation_refs`
- Codex run event / 可选 OpenHands UI 跳转链接。
- Event cursor 同步。

验收标准：

- Development 任务可由 `codex-cli` 完成一次代码修改。
- 用户能从 run detail 看到 Codex event、workspace、prompt release、summary 和 next state。
- Codex 输出中的 agent message / command / file / status 摘要能写入 `run_events`，入库前完成最小脱敏和高信号事件归一化，并同步到 Progress / Workpad。
- Codex 失败时，Control Plane 能记录失败原因并决定 retry/block。

当前验收结果：

- 已验证 mock adapter run 会写入 `conversation_refs`。
- 已验证 run detail API/UI 可读取并展示 conversation ref。
- 已验证 `codex-cli` adapter fake run 会写入 Codex event 并返回 Code Review next state。
- 已验证 `codex-app-server` adapter fake run 会写入 Codex event、conversation ref 并返回 Code Review next state。
- 已验证 DB-driven `worker:codex-smoke` 会用 `codex-cli` 或显式 `codex-app-server` 写入 workspace、prompt release、Codex event、conversation ref、任务级 Agent Events Progress，并推进到 Code Review。
- 已验证本机真实 `worker:codex-real-smoke` 会用 `codex-cli` 和显式 `codex-app-server` 写入 workspace、prompt release、Codex event、conversation ref、任务级 Agent Events Progress，创建 marker 文件并推进到 Code Review。
- 已用单元测试验证 `codex-app-server` previous conversation resume：已有 thread ref 时不再调用 `thread/start`，而是用旧 thread id 启动新 turn 并写入 `codex.thread_reused`。
- 已用本地 DB-driven smoke 验证 `WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true pnpm worker:codex-smoke` 会在同一 fake app-server 进程内完成 Development 和 Code Review 两个 turns，第二次 run 写入 `codex.thread_reused` 并复用同一 thread id。
- 已用单元测试验证 Worker loop 多轮 poll 只创建一次 execution adapter 并在退出时 dispose。
- 已用单元测试验证 `openhands-cloud` V1 start task / conversation status polling。
- 尚未验证真实 Plane task + `codex-cli` 或 `codex-app-server` 端到端 run。

风险：

- `codex exec` 和 `codex-app-server` 单 turn 都已能跑通本机真实 Worker smoke，previous thread resume、loop-level adapter 复用和 persistent fake app-server follow-up 已有本地验证，但真实 app-server 长会话复用仍需验收。
- OpenHands 的工具权限模型如果未来启用，需要和现有 Codex 运行方式重新对齐。
- workspace 隔离、secret 注入、git 凭据需要单独验证。

## P5 本地观测与可选 Langfuse

目标：默认用 Control Plane 自己的 run events / Progress / Workpad / audit events 追踪 agent 执行；Langfuse 只作为未来可选观测增强。

状态：本地 run events、Progress、Workpad、trace ref 写入骨架和 Prompt version metrics 已完成；Worker 已接入可选 Langfuse JS/TS SDK instrumentation 骨架。Langfuse 不再是第一版默认完成条件。

模块：

- 本地 run events / Progress / Workpad
- 可选 Langfuse project setup
- Trace instrumentation
- Prompt registry integration
- Token/cost collector
- Trace linking
- Eval/annotation

关键能力：

- 每次 run 的关键执行事件写入 Control Plane。
- trace 关联 task/run/conversation/prompt release/repo/role。
- 收集 token、cost、latency。
- 从 run detail 查看本地事件；可选跳转 Langfuse trace。
- 按 prompt version 统计成功率、平均成本、平均 token。

已完成：

- adapter result 已支持返回 trace refs。
- worker 已可将 adapter 返回的 trace refs 写入 `trace_refs`。
- 写入 `trace_refs` 时会同步累加 `runs.token_input`、`runs.token_output`、`runs.token_total` 和 `runs.cost_usd`。
- mock adapter 已可写入 `provider=mock-langfuse` 的 trace ref，供 run detail 链路验证。
- OpenHands Cloud adapter 已可从 conversation payload 的 `trace_refs` / `traceRefs` / `traces` 和 event/message payload trace 字段提取外部 trace ref，并保留 generation/model/token/cost/latency/UI URL。
- Worker 已接入 `@langfuse/tracing` 和 `@langfuse/otel`，可在启用后为每次 run 创建 `agent-run` observation。
- `LANGFUSE_ENABLED=true` 且 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 存在时，worker 会启动 `NodeSDK + LangfuseSpanProcessor`。
- Langfuse run observation 会记录 run/task/repo/role/prompt release/worker/execution adapter 元数据，input 包含最终 rendered prompt，output 包含 run status/summary/reason、OpenHands adapter 事件摘要和 adapter trace refs，并把 trace id 写回 `trace_refs(provider=langfuse)`。
- 如果配置 `LANGFUSE_PROJECT_ID`，trace ref 会生成 Langfuse UI URL：`<baseUrl>/project/<projectId>/traces/<traceId>`。

交付物：

- `trace_refs`：已建表并可由 worker 写入。
- Langfuse SDK 集成：已完成最小 run-level instrumentation，默认不启用。
- Prompt version metrics 页面：已完成最小 API/UI，按 component version 聚合 release/run/成功率/token/成本。

验收标准：

- 用户能看到每次 run 的 prompt、output、token、cost：部分完成，本地 run detail 已展示 prompt release、run events 和 token/cost summary；逐 LLM call 级别 trace 不作为第一版默认目标。
- 用户能按 prompt version 查看历史 run 表现：最小完成，可在 prompt detail 页面查看关联 release/run、成功率、token、成本和最近 runs。
- run detail 有本地事件和可选外部 trace 链接：本地链路已完成，真实 Langfuse 链接仅作为可选增强待验证。

当前验收结果：

- 已验证 mock adapter run 会写入 `trace_refs`。
- 已验证 run detail API/UI 可读取并展示 trace ref。
- 已验证 `runs` token/cost 汇总会随 trace ref 写入更新。
- 已用单元测试验证 Langfuse disabled 模式不会写入 trace ref，避免无 credentials 时影响 worker。
- 已用单元测试验证 Langfuse observation input 包含 rendered prompt，output 包含 run status/summary，并生成 trace UI URL。
- 已用单元测试验证 OpenHands conversation payload 和 event/message payload 中的 trace ref 可被提取并归一化。
- 尚未验证真实 Langfuse SDK trace 进入 Langfuse UI；这不阻断第一版 Codex-first 完成。

风险：

- trace 默认完整保存，调试便利优先；只做最低限度 secret 防护。Control Plane `run_events` 中的执行摘要会做常见 secret redaction。
- Langfuse 与 OpenHands 的 callback/instrumentation 方式只有在未来启用对应可选集成时才需要实测。

## P6 状态机闭环

目标：恢复并增强当前 Symphony 状态机能力。

状态：核心规则已在 `packages/core` 实现；Worker 已验证部分自动推进；反馈摄取 API、人工 gate UI、worker 完成态 Plane 回写、人工 gate/rework API Plane 回写和本地 workflow 全链路 smoke 均已具备最小链路。真实 Plane 上的人工 gate 回写 smoke 仍待复测。

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
Done              -> Terminal
```

关键能力：

- 自动状态由 Control Plane 派发。
- 人工状态只等待用户操作。
- reviewer/human 打回后，Development agent 必须读到反馈。
- agent 完成后只建议或执行允许的状态转移。

已完成：

- 状态机常量和自动/人工状态分类。
- role routing。
- 允许状态转移规则。
- Development 完成后默认推进 Code Review。
- Code Review 完成后默认推进 Human Review。
- `POST /api/tasks/[taskId]/rework` 可写入 actionable feedback，并将允许返工的任务退回 Development。
- Development prompt release 会注入 unresolved feedback。
- `GET /api/tasks` 和 `/tasks` 可查看 agent/human/blocked/terminal 任务。
- `/tasks/[taskId]` 可按 allowed next states 执行人工 gate，通过、短路 Done/Canceled 或打回 Development。
- `POST /api/tasks/[taskId]/transition` 会走状态机校验并写入 `audit_events`。
- worker 完成后可按配置回写 Plane work item state 和 summary comment。
- `POST /api/tasks/[taskId]/transition` 和 `POST /api/tasks/[taskId]/rework` 会在 `PLANE_WRITEBACK_ENABLED=true` 时回写 Plane state/comment。
- `pnpm worker:workflow-smoke` 会在临时库中跑完 `Development -> Code Review -> Human Review -> In Merge -> Merged -> Release Version -> Released -> Deployment -> Deployed -> Done`，自动状态由 worker 执行，人工 gate 用 `transitionTaskState` 模拟。
- Worker 会写入 `feedback_items(source=agent_progress)` 作为任务级 workpad/progress；Task Detail 单独展示 Progress / Workpad，不混入 unresolved feedback。
- `POST /api/tasks/[taskId]/feedback` 可写入 PR review feedback，默认不改变状态；设置 `requestRework=true` 时复用 rework 流程把任务退回 Development。

未完成：

- 人工 gate 操作后的真实 Plane 状态/comment 回写 smoke。

交付物：

- `state_transition_rules`
- `role_router`
- `feedback_collector`
- `plane_state_sync`

验收标准：

- Development 完成后能进入 Code Review。
- Code Review 发现问题能回 Development。
- Human Review 打回后能回 Development，并保留反馈。
- Merged/Released/Deployed 由人决定下一步。

当前验收结果：

- 已验证 Development 完成后进入 Code Review。
- 已验证 Code Review mock 完成后进入 Human Review。
- 已用 API 和数据库 smoke 验证 Human Review 打回 Development，并在下一次 Development run 的 prompt release 中注入 feedback。
- 已用 `pnpm worker:workflow-smoke` 验证本地 mock 全链路，覆盖 merge/release/deploy 自动状态与人工 gate 串联。
- 已用 `pnpm worker:workflow-smoke` 验证每个自动 run 至少写入 Running / Completed 两条 task-level `agent_progress`。
- 已用单元测试覆盖 PR review feedback 摄取、重复去重和缺任务分支。
- 已实现人工 gate 最小产品界面。
- 已用单元测试覆盖 Plane task state writeback helper 和 Web writeback 开关/失败返回。
- 已用 Web operator 单元测试覆盖 `/api/tasks` 只读开放和 `transition` / `rework` / `feedback` owner/admin 变更门禁。
- Plane writeback smoke harness 已能在 apply 模式下 PATCH state、POST comment，并回读验证 state/comment。
- 尚未在真实 Plane project 上复测人工 gate 操作后的状态/comment 同步。

风险：

- 状态流转权限要严格，避免 agent 越过人工 gate。
- Plane 与本地状态可能短暂不一致，需要 reconciliation。

## P7 多 repo / 多 project / 多 agent

目标：支持一个 team 下多个 project，一个 project 下多个 repo，多个 agent 并发执行。

状态：本地最小闭环已完成。repo routing、project 下多 repo、不同 role 的 agent definition、repo/role prompt 注入已在现有闭环中落地；agent pool 已按 role 从 active agent definitions 中选择当前最空闲的 agent；`WORKER_REPOSITORY_CONCURRENCY_LIMIT`、`WORKER_ROLE_CONCURRENCY_LIMIT` 和 `WORKER_AGENT_CONCURRENCY_LIMIT` 已提供 dispatch/claim 双层并发门禁；`WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` 和 `dispatch.max_estimated_cost_usd_per_run` 已提供单 run 估算成本门禁，其中 DB 持久化配置优先于 env；预算超限任务会自动进入 `Blocked` 并写入任务级 Progress / Workpad；queue priority 已支持 `priority_first` / `priority_aging` / `repo_fair` / `weighted_priority` / `oldest_first` / `newest_first` 六种策略。真实多 worker/多 repo 长时间运行下的公平性调优仍需生产数据。

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
- 同 role 可限制并发，避免单角色 agent 池被抢爆。
- 同 agent definition 可限制并发，避免同一个 agent definition 被持续压满。
- 单 run 可按估算成本门禁阻断派发，避免超预算任务进入 agent 执行。
- 第一版估算成本从 Plane label `cost:<usd>` 同步到 `tasks.estimated_cost_usd`。
- 队列优先级支持六种策略：`priority_first` 使用 Plane 同步来的 `tasks.priority`，数字越小越优先；`priority_aging` 在 priority 基础上按等待时间提升有效优先级；`repo_fair` 按 repo 内 priority/updated_at 排队并跨 repo 轮转；`weighted_priority` 在 priority 基础上叠加 `estimated_cost_usd`，同等优先级下低成本任务优先；`oldest_first` 按更新时间升序；`newest_first` 按更新时间降序。

交付物：

- `repository_routing_rules`
- `agent_pool`：已完成同 role active agent definition 的 least-busy 选择，避免永远命中最早创建的 agent。
- `concurrency_policy`：已完成 worker 环境变量和 DB claim 门禁最小链路。
- `budget_policy`：已完成 `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` env fallback、`app_settings(dispatch.max_estimated_cost_usd_per_run)` 持久化配置、`/settings` 表单和 `PUT /api/dispatch/policy` 最小链路。
- `queue_priority`：已完成 `dispatch.queue_priority_policy` 持久化配置，支持 `priority_first`、`priority_aging`、`repo_fair`、`weighted_priority`、`oldest_first`、`newest_first`。

验收标准：

- 同一 project 下不同 repo 任务能进入不同 workspace。
- repo prompt 能正确注入。
- role prompt 能正确注入。
- 超过并发限制的任务保持 queued：repo/role 并发限制已用单元测试覆盖，跨 worker claim 使用 PostgreSQL advisory lock 串行检查。
- 单 agent definition 超过并发限制时不会继续被选中；agent pool 会优先选择 active run 更少的 agent definition。
- 超过单 run 估算成本预算的任务保持 queued：dispatch policy、worker dispatch cycle、DB 持久化配置覆盖和清空已用单元测试覆盖。
- queue priority policy 会影响 dispatch snapshot 排序：`priority_first` 按 Plane priority 再更新时间，`priority_aging` 按 `coalesce(priority, 1000000) - floor(wait_hours / 24)` 再 priority/更新时间，`repo_fair` 按 repo 内 priority/updated_at 计算 `row_number()` 后跨 repo 轮转，`weighted_priority` 按 `coalesce(priority, 1000000) + coalesce(estimated_cost_usd, 0)` 再 priority/cost/更新时间，`oldest_first` 按更新时间升序，`newest_first` 按更新时间降序。
- priority 较小的任务会优先出现在 Task Queue 和 dispatch snapshot 中；同 priority 下按更新时间升序处理。
- 超过预算的任务进入 `Blocked`，并在任务级 Progress / Workpad 写入预算超限原因。

风险：

- 多 agent 并发可能造成 git/PR 冲突。
- repo label 缺失或错误会导致任务派发失败，必须早阻断。
- `git-worktree` 能降低同 repo 并发写冲突；cleanup 已接入 Git 原生命令清理 metadata，但 Git 命令失败后的 fallback 仍可能需要人工检查主仓库 `git worktree list`。

## P8 生产化与迁移

目标：从当前 Linear/Symphony 实验环境迁移到新的平台化架构。

状态：部分完成。当前快速状态总览见 `docs/agent-control-plane-status.md`。镜像发布、Compose 部署、应用镜像回滚、数据库备份/恢复、首页监控 dashboard 最小指标、基础告警、阈值 UI/API 动态配置、generic/slack/email webhook 告警通知、告警失败重放队列、secret validate gate、secret env file/rotation/expiry warning 最小链路、secret rotation audit log、外部 secret command 接入、secret provider smoke、provider audit file/command smoke、production smoke harness、可选外部依赖只读探针、Plane writeback smoke harness、cutover gate、趋势图、Linear export -> Plane 迁移脚本和生产 runbook 已完成最小链路；真实端到端外部 smoke 和完整迁移切换仍未完成。

模块：

- Data migration
- Backfill
- Access control
- Audit log
- Secret management
- Backup/restore
- Deployment
- Monitoring

关键能力：

- 迁移现有 team/project/repo/prompt。
- 从 Linear 导出未完成任务，导入 Plane。
- 保留旧 run/log 链接。
- 配置权限和审计。
- 部署 Control Plane。
- 发布带 git revision label 的 Control Plane 镜像。
- 按固定 `ACP_IMAGE` 部署 Web/Worker。
- 回滚 Web/Worker 到上一镜像。
- 备份和恢复 PostgreSQL 数据库。
- 监控 queue length、run success rate、token/cost、stalled runs。

交付物：

- Migration scripts：`pnpm linear:migrate` 可读取 Linear export JSON，默认 dry-run，设置 `LINEAR_MIGRATION_APPLY=true` 后创建 Plane work items。
- Deployment manifests：Compose 已支持 `ACP_IMAGE` 固定镜像部署。
- Release/deploy/rollback scripts：`scripts/release-image.sh`、`scripts/deploy-compose.sh`、`scripts/rollback-compose.sh`。
- Backup/restore scripts：`scripts/db-backup.sh`、`scripts/db-restore.sh`。
- Monitoring dashboard：首页已展示 queue length、active runs、human gates、blocked、stalled、retry backlog、24h success/failed、token/cost、基础告警、当前阈值和 12h/24h/7d 可切换趋势图；`/settings` 和 `GET/PUT /api/monitoring/thresholds` 已支持动态阈值配置，写入 `app_settings` 并记录 audit event；worker 已支持配置 webhook 后发送 generic/slack/email active alerts，并将失败 payload 写入 `monitoring_alert_notifications` 等待重放。
- Runbook：`docs/agent-control-plane-production-runbook.md`。

当前 P8 已完成的最小闭环：

- release image / deploy compose / rollback compose 脚本。
- PostgreSQL backup / restore 脚本。
- readiness、tasks、runs 的部署后 smoke 命令。
- 首页基础监控、基础告警、12h/24h/7d 可切换趋势图。
- 监控阈值 DB 动态配置、UI/API 更新、audit event。
- 告警失败重放队列。
- 部署前 secret 校验。
- 本机 secret env file 注入、`pnpm secrets:rotate` 轮换脚本、secret expiry warning 和本机 JSONL rotation audit log。
- 外部 secret command 接入，支持 1Password/SOPS/Vault 类工具输出 dotenv 后注入 validate/deploy/smoke/cutover；`pnpm secrets:provider-smoke` 可验证 provider 输出可通过 production secret gate；`pnpm secrets:provider-audit-smoke` 支持文件或 `SECRET_PROVIDER_AUDIT_COMMAND` 两种 JSONL 输入。
- `pnpm smoke:production` 覆盖 readiness、auth session、runs、tasks、audit events、users 只读 smoke，readiness 默认要求 `database.connected=true`；可显式开启用户写入口 smoke，也可用 `ACP_SMOKE_EXTERNAL=true` 开启 Plane/OpenHands/Langfuse 外部依赖只读探针。
- `pnpm openhands:smoke` 支持 OpenHands 只读 probe 和真实 conversation 创建 smoke；设置 `OPENHANDS_SMOKE_PAYLOAD_FILE=/secure/raw-openhands-payload.json` 后会回读 conversation/event log 并写出权限为 `0600` 的 payload contract JSON；`pnpm openhands:payload-contract` 可对本地或真实 OpenHands conversation/event log JSON 做离线解析契约校验，覆盖 terminal decision、event summary、trace ref 和 secret 脱敏；`pnpm openhands:adapter-smoke` 可直接执行 worker `OpenHandsCloudAdapter`，验证 terminal status、conversation ref、event summary 和 role next state；`pnpm openhands:db-smoke` 可 upsert smoke task 并验证数据库驱动 worker run 的 prompt release、conversation、events 和 next state，并输出 OpenHands `ui_url` 与首个 `trace_ui_url` 供 cutover evidence 归档；DB smoke 应使用专用 smoke project，或在临时库中设置 `OPENHANDS_DB_SMOKE_ISOLATE_PROJECT=true` 隔离其它自动任务；这些入口都支持 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND` 注入 secret。`pnpm langfuse:smoke` 支持真实 Langfuse trace smoke 和本地 dry-run 配置验证。
- `pnpm cutover:check` 已支持 profile-aware gate 编排：默认 `codex-cli` profile 覆盖 Plane writeback、Codex Worker run、任务来源审计、本地 worker 崩溃恢复、预算门禁、完整 workflow、本地旧 Linear/Symphony poller 只读确认和 Linear 归档确认；OpenHands conversation/adapter/DB run 与 Langfuse SDK trace 只在 legacy external profile 中强制。设置 `ACP_CUTOVER_REPORT_FILE` 后会输出带 `reportId` 和 `completionFinalRunId` 的机器可读 JSON 报告，已存在 report 默认拒绝覆盖，只有 `ACP_CUTOVER_REPORT_OVERWRITE=true` 才允许替换；`ACP_CUTOVER_REPORT_ID` / `ACP_EXTERNAL_PREFLIGHT_ID` 可把证据绑定到外部变更单、final run 或 cutover issue。
- `pnpm cutover:codex-rehearsal` 启动本地 mock Plane、临时数据库、临时 secret provider dotenv 和临时 provider audit JSONL，并使用默认 `codex-cli` profile 调用 `pnpm cutover:check` 验证 Codex-first gate 编排；它自动覆盖 Plane writeback、Codex adapter、task-source、worker crash/budget/workflow、secret provider 和 provider audit smoke，并确认 OpenHands/Langfuse legacy smoke 不参与默认 profile。`pnpm cutover:rehearsal` 继续显式使用 `legacy-openhands` profile 覆盖可选 legacy gate 编排。两类 rehearsal report 都必须被 `completion:audit` 拒绝，不能作为生产批准信号。
- `docs/agent-control-plane-status.md` 记录当前已完成能力、未真实验收项和下一批推荐任务，作为继续开发时的第一入口。
- `pnpm linear:migrate` 覆盖 Linear export -> Plane work item 最小迁移：保留原 identifier、Linear URL、原状态、description；默认跳过 `Done` / `Canceled` / `Duplicate` 终态，支持 dry-run 和显式 apply。
- `pnpm linear:migrate-smoke` 已覆盖迁移脚本的本地 mock Plane 合约：dry-run 不创建 work item，apply 创建非终态 issue，终态 issue 默认跳过，state/label/priority 映射、缺失 label 计数和原 Linear URL/identifier provenance 都会被验证。
- `pnpm task-source:local-smoke` 已覆盖任务来源审计的本地临时 DB 合约：默认 `codex-cli` profile 要求 Plane URL、repo routing、Control Plane run、Codex run events 和 Progress / Workpad evidence 都存在；OpenHands conversation evidence 和 Langfuse trace evidence 只属于 legacy/optional profile，且 seed 自带自动任务会被隔离，避免污染样本。
- OpenHands Cloud adapter 本地摘要已补齐 file operation 分类：文件 read/write/edit/patch/path/diff 类事件写为 `openhands.file_operation`，浏览器或其它非文件工具仍保持 `openhands.tool_call`；该增量已通过 worker test/typecheck、prettier、`git diff --check` 和 `pnpm check`。
- Operator password 登录、signed session cookie、`/session` 管理页。
- DB-backed operator user、`/users` 用户管理页、owner/admin 用户创建/更新。
- 细粒度页面/API ACL 和高级审计查询。

当前 P8 仍未完成的生产化闭环：

- 按生产边界拆出 3 个自有源码仓库：`michaelx1993/plane`、`michaelx1993/agent-control-plane`、`michaelx1993/agent-worker`，并建立各自 CI、镜像构建和部署脚本。
- Plane 自有 fork 的生产化部署链路：确认/同步 `michaelx1993/plane` fork、固定 upstream/version、建立自有镜像或 Compose 发布流程，并把 repo 一等字段等二开需求进入该 fork backlog。
- 真实生产环境 smoke，包括 Plane writeback、Codex Worker run、Control Plane run events / Progress / Workpad 和生产数据库迁移部署。
- 真实供应商账号/API 审计 smoke。
- 从 Linear/Symphony 到 Plane/Control Plane 的正式 cutover rehearsal 和旧 Symphony poller 冻结确认。
- 真实 task-source smoke 结果：脚本已完成，但还没在真实 Plane/Control Plane cutover 样本上验收。

验收标准：

- 新任务完全走 Plane。
- 新 prompt 完全走平台。
- 新 run 都有 Codex run events、Progress / Workpad、prompt release、workspace 和 summary；OpenHands/Langfuse 链接仅作为可选增强。
- 旧 Linear 只保留归档，不再作为 agent 任务源。

风险：

- 迁移期间可能出现双写和重复派发。
- 需要冻结旧 Symphony poller 或确保只读。

## 推荐任务拆分

第一批剩余任务按当前仓库状态重新排序：

1. 完成仓库拆分计划并创建/整理 3 个自有源码仓库：`michaelx1993/plane`、`michaelx1993/agent-control-plane`、`michaelx1993/agent-worker`。
2. 确认并纳入 `michaelx1993/plane` 自有 fork：同步 upstream、固定版本、沉淀自部署流程，并把 repo 一等字段/agent 状态嵌入等二开需求写入 Plane fork backlog。
3. 将当前 `apps/web`、`packages/core`、`packages/db`、`packages/plane` 迁入 `agent-control-plane`；新增 Worker API server contract，保证它是唯一 DB 访问层。
4. 将当前 `apps/worker` 的执行器、workspace manager 和 Codex adapter 迁入 `agent-worker`；移除生产路径中的 `@agent-control-plane/db` 依赖，改用 Control Plane HTTP client。
5. 使用真实 Plane task + 真实 repo 跑通默认 `WORKER_EXECUTION_ADAPTER=codex-cli` 的 Development run，并按需复测 `WORKER_EXECUTION_ADAPTER=codex-app-server`。
6. 用真实 Plane task 和真实 cutover report 验证 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 默认口径，覆盖 Codex run events、Progress/Workpad、Plane writeback、task-source、secret provider 和 provider audit。
7. 使用真实 Plane project 复测人工 gate 状态/comment 回写 smoke。
8. 基于真实 Codex 返回结果调优 completion/retry/block 策略。
9. 补真实生产环境 smoke 和真实供应商账号 API 审计 smoke。
10. 做完整 cutover rehearsal：冻结旧 Symphony poller、用真实 Plane project 执行 Linear export -> Plane import、Plane sync、真实 Codex Development run、Plane writeback 抽查、`pnpm task-source:smoke`，并确认新任务只从 Plane/Control Plane 派发。

已完成的基础任务：

- 创建 `apps/web`。
- 创建 `apps/worker`。
- 创建 `packages/core`。
- 实现 workflow state machine。
- 实现 repo label fallback parser。
- 实现 dispatch decision。
- 实现 prompt renderer。
- 补 core 单元测试。
- 创建 `packages/db`。
- 实现 Prisma 7 schema。
- 补 DB schema validation gate。
- 创建首个 Prisma migration。
- 创建 seed SQL。
- 在本机 PostgreSQL 独立测试库验证 migration + seed。
- 补 Web dashboard/readiness/dispatch preview。
- 补 Worker fixture dispatch cycle。
- 将 Web dashboard/readiness 切到 PostgreSQL summary。
- 将 Worker dispatch input 切到 PostgreSQL 查询。
- 将 Worker claim lease 写入 `runs` 和 `run_events`。
- 将 Worker mock 生命周期写入 `running` / `heartbeat` / `succeeded` 并推进默认下一状态。
- 验证 `Development -> Code Review -> Human Review` 的本地数据库推进。
- 接入 mock OpenHands adapter，替换 worker 内联 mock completion。
- 实现 prompt component/binding/release 最小模型。
- worker 执行前生成 prompt release，并注入 adapter。
- 提供 `GET /api/prompt-releases`。
- 提供 run detail API/UI。
- 提供 prompt release detail API/UI。
- 提供 Prompt Manager component CRUD / diff / rollback 最小 API/UI。
- 提供 Project Settings / Prompt Binding 最小 API/UI。
- 提供 Docker Compose 最小本地栈。
- 提供 GitHub Actions CI release gate。
- 提供 rework API，并验证 Human Review -> Development -> Code Review 返工闭环。
- 提供 `worker:workflow-smoke`，并验证 Development -> Code Review -> Human Review -> In Merge -> Merged -> Release Version -> Released -> Deployment -> Deployed -> Done 本地闭环。
- 创建 Plane self-host runbook。
- 创建 Plane API/webhook capability matrix。
- 确认 Plane fork：`michaelx1993/plane`。
- 启动 Plane self-host。
- 完成 Plane PAT/API smoke test。
- 完成 Plane webhook smoke test。

## 里程碑

### M1: Task Sync 可用

- Plane task 能同步到本地。
- repo 缺失会阻断派发。
- 状态变更可双向同步。

### M2: Runtime Queue 可用

- run/lease/heartbeat/retry 可用。
- 可从 API 查看运行状态。

### M3: Prompt Platform 可用

- prompt 不再依赖 GitHub。
- 每次 run 绑定 prompt release。

### M4: Codex Worker Run 可用

- Development 任务可完成真实代码修改。
- run events、Progress / Workpad、prompt release、workspace 和 summary 可查看。

### M5: 本地 Observability 可用

- 本地 run events / Progress / Workpad / audit 可查看。
- token/cost 可统计。

### M6: Workflow 闭环可用

- Development -> Code Review -> Human Review -> In Merge 可跑通。
- 打回返工可跑通。

## 当前已定实现口径

- Plane 当前使用本机/self-host Docker Compose 做开发验证，生产部署位置仍在 cutover 前确定；无论部署在哪，Plane 都按 self-host + 自有 fork 可二开前提设计，目标 fork 为 `michaelx1993/plane`。
- 生产仓库拆分目标固定为 3 个自有源码仓库：`michaelx1993/plane`、`michaelx1993/agent-control-plane`、`michaelx1993/agent-worker`；所有运行组件都从这 3 个仓库构建和部署。
- Workspace manager 第一版已定为本机目录：repository `local_path` 优先，否则 `WORKER_WORKSPACE_ROOT/<repo>/<runId>`；需要隔离同 repo 并发修改时可启用 `WORKER_WORKSPACE_STRATEGY=git-worktree`。
- Plane repo 字段当前使用 `repo:<slug>` label fallback；正式产品不长期依赖 label，后续 Plane fork 二开时补一等 repo 字段。
- Agent 执行日志第一版以 Control Plane 为事实源：保存脱敏轻量摘要流到 `run_events` 和任务级 Progress / Workpad；OpenHands/Langfuse UI 仅在未来启用可选集成时跳转。
- Review 打回第一版采用 `feedback_items`：PR review / human / Plane comment 写入 unresolved feedback，必要时把任务退回 `Development`；下一次 Development prompt release 注入这些反馈。

## 已定决策

- Plane 使用 self-host，后续一定可二开。
- Plane 源码必须纳入自有 fork 和自部署链路；当前 fork 目标是 `michaelx1993/plane`，不长期依赖官方托管或不可控镜像。
- Control Plane 与 Worker 必须拆成可独立部署的自有源码仓库；Worker 生产路径只连 Control Plane Worker API，不连 DB。
- repo 字段正式方案不长期依赖 label；label 只作为 MVP 兜底。
- Prompt 主库放 Control Plane；Langfuse 仅作为未来可选 trace/eval。
- 默认观测由 Control Plane 本地 run events / Progress / Workpad / audit 承担。
- Control Plane 与 Plane 职责分离：Plane 管人类任务，Control Plane 管 agent runtime。
- 技术栈采用 TypeScript / Node 24 / pnpm workspace / Next.js / PostgreSQL / Prisma / Vitest。
- Symphony 作为旧编排实验保留，不作为新平台核心 runtime。

## 仍需讨论

- Codex workspace 后续是否升级 Docker sandbox 或远程 runtime。
- Plane 二开深度：只改字段/UI，还是后续把 agent run 状态嵌入 work item 页面。
- Symphony 名字是否保留：作为兼容层、模块名，还是新项目彻底命名为 Agent Control Plane。
- Plane 生产环境是否默认启用 `PLANE_SYNC_SERVER_DELTA=true`；当前代码支持 `updated_after` best-effort 和 fallback，且 comment polling 不依赖 delta 结果，但真实 Plane 版本仍需验证该参数稳定可用并确实降低返回量。
