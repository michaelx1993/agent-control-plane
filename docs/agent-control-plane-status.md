# Agent Control Plane 当前状态

更新时间：2026-06-25

本文只记录当前仓库的实现与验收边界，避免把“代码已落地”和“真实环境已验收”混在一起。详细产品设计看 `agent-control-plane-prd.md`，数据模型看 `agent-control-plane-erd.md`，阶段路线看 `agent-control-plane-roadmap.md`，当前明确待办看 `todo.md`。

## 总判定

当前已经完成 Control Plane 的本地最小闭环：任务镜像、状态机、prompt release、worker claim/lease/retry、workspace 准备、任务级 Progress / Workpad、PR review feedback 摄取、ExecutionAdapter 骨架、OpenHands 可选 adapter 骨架、Langfuse 可选 trace 骨架、Plane writeback smoke harness、生产 smoke、secret provider smoke、provider audit smoke、cutover gate、监控和基础权限。

当前还不能判定为生产完成。方案已调整为省钱优先：默认不依赖 OpenHands Cloud、Langfuse Cloud 或任何需要额外付费的 SaaS/Enterprise license。`codex-cli` adapter 已有最小 `codex exec --json` 实现、单元测试、`pnpm codex:adapter-smoke` 和 DB-driven `pnpm worker:codex-smoke`，但还不是完整生产替代。剩余主线是继续把 Symphony 已验证过的 Codex 执行方式产品化到 Worker：

- `codex-cli` / `codex app-server` ExecutionAdapter：第一阶段已能在目标 repo workspace 中执行 `codex exec --json`，注入 prompt release 和 task context，消费 JSONL 输出；`codex-app-server` adapter 第一阶段已支持 `initialize -> thread/start -> turn/start -> turn/completed` 的 stdio JSON-RPC 生命周期，并复用 Codex 事件归一化/脱敏；Worker 会把同一 task 的上一条同 provider `conversation_ref` 注入下一次执行，`codex-app-server` adapter 能从上一条 ref 恢复 thread id 并直接启动新 turn；Worker loop 会在进程内复用同一个 execution adapter 实例，`codex-app-server` 默认开启 persistent session，让多轮 turn 共用同一个 app-server 进程，`WORKER_CODEX_APP_SERVER_PERSISTENT=false` 可退回每 turn 新进程；`worker:codex-smoke` 已验证 Worker 可用 fake Codex 走通 claim、git-worktree workspace、prompt release、`run_events`、`conversation_refs`、Progress 事件摘要和 Development -> Code Review；`worker:codex-real-smoke` 已用本机真实 Codex 分别跑通 `codex-cli` 单 turn、`codex-app-server` 单 turn，以及 `codex-app-server` follow-up 两轮同 task thread reuse；后续补真实 Plane task 和 Plane writeback。
- Codex/OpenHands run event 摘要已写入 `run_events`，并会把高信号 agent message / command / file / error 摘要同步到任务级 Progress / Workpad；Codex stdout JSONL、plain stdout 和 stderr 在入库前都会做 token / secret / password / Bearer 最小脱敏；常见 Codex app-server method / wrapper 事件会归一到 agent message、reasoning、exec command、file operation、plan、token usage 等高信号类型；Worker loop 已复用同一个 execution adapter 实例，persistent `codex-app-server` 会避免每个轮询周期重复初始化 app-server 进程；真实 Codex 长任务还需用实际返回继续校准摘要粒度。
- Codex turn completed / input required / failed / stalled 映射到 Control Plane run status 和状态机推进。
- 真实 Plane project 上的状态/comment writeback 复测。
- 真实 production smoke 的外部依赖只读探针。
- 真实 task-source 样本证明新任务只从 Plane/Control Plane 派发。
- 真实 secret provider command smoke。
- 真实供应商账号/API 的 provider audit smoke。
- 基于上述证据生成并通过 `completion:final` / `completion:audit` 的 cutover report。

当前 `pnpm cutover:rehearsal` 已提供本地 mock 外部服务的一键演练，用来验证 cutover gate 和 smoke harness 的编排；它不是生产批准信号。真实完整演练还必须覆盖：冻结旧 Symphony poller、Linear export -> Plane import、Plane sync、真实任务从 Plane 被 Control Plane 派发、Codex adapter 执行、Control Plane run events 可追踪、状态/comment 回写 Plane，以及 Linear 进入只读归档。

## 方案调整：省钱执行链路

2026-06-19 追加决策：

- 默认执行器从 “OpenHands Cloud” 调整为 “Codex CLI / `codex app-server` adapter”。
- 默认观测从 “Langfuse Cloud trace” 调整为 “Control Plane 本地 run events + Progress + Workpad + audit events”。
- 生产部署目标已调整为 3 个自有源码仓库：`michaelx1993/plane`、`michaelx1993/agent-control-plane`、`michaelx1993/agent-worker`。所有运行组件都必须由我们自己的源码、CI、镜像和部署脚本交付。
- 分布式部署目标要求 Worker 不直连 PostgreSQL；只有 Agent Control Plane Web/API 访问 Control Plane DB。当前 `apps/worker` 直接依赖 DB 只是本地闭环和 smoke harness 的过渡实现，生产目标是 Worker 通过内部 HTTPS Worker API claim、heartbeat、写事件、写进度、complete/fail。
- OpenHands 和 Langfuse 保留为可选集成，不进入第一版必需完成条件。
- 所有付费 Cloud/SaaS/Enterprise license 默认不考虑；只有证明 ROI 后才进入默认架构。
- `completion:final`、`external:preflight`、`completion:audit` 已支持 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 默认 profile；OpenHands/Langfuse 已保留为 legacy/optional profile。
- 下一步开发目标是用真实 Plane task 跑通 `codex-cli` Development run，并让最终门禁以真实 Codex run evidence、Progress/Workpad、Plane writeback 和 task-source evidence 通过审计。

## 最近一次本地验收

2026-06-20 增量验收：

- 本轮修复 Worker claim/complete 状态推进裂口：Worker API `complete` 现在会校验 `nextStateSuggestion` 为合法 workflow state，并由 Control Plane 在同一 completion 流程中推进 `tasks.state`；`claimRuns` 不再选择已有 `succeeded` run 的 task，避免 Development task 因状态未推进而被重复 claim 形成循环。该增量已通过 `pnpm check`、`pnpm format` 和 `git diff --check`。
- 本轮继续修复 Worker claim 队列扫描裂口：`claimWorkerRuns(maxRuns=1)` 不再只检查队首 1 条任务；队首任务未路由或不可派发时会记录 skipped 并继续扫描后续候选，避免一个坏任务饿死同项目/同队列后的真实可派发任务。
- 本轮追加修复 DB claim 拒绝后的填充逻辑：当候选任务在 `claimRuns` 内因已有 succeeded run、并发锁或其它事务条件未插入时，Worker API 会继续尝试后续候选，直到实际成功 claim 数达到 `maxRuns` 或候选耗尽。
- PR #3 已合入 `main`：新增 opt-in `worker:codex-real-smoke` 和 `worker:codex-plane-smoke`，Run Detail conversation 标签改为 provider-aware，默认 Codex CLI 参数保持 `gpt-5.5` + high reasoning。
- PR #4 已合入 `main`：修复 `/api/tasks` 和 `/api/runs` 在 PostgreSQL enum 字段与 text filter 比较时返回 500 的问题，`TaskState` / `RunStatus` 过滤统一使用 `::text` 比较。
- PR #6 已合入 `main`：新增 `operator:query-smoke`，在临时 PostgreSQL 数据库上执行真实 `listOperatorTasks` / `listOperatorRuns` 查询，覆盖 operator queue/run filters 的 enum/text 兼容问题；该 smoke 已纳入 `completion:local-smoke` 和 doc/script parity gate。
- PR #13 已合入 `main`：`worker:codex-smoke` 现在覆盖默认 fake `codex-cli` 和显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` 两条 Worker DB smoke；`completion:local-smoke` 也纳入默认 `worker:codex-plane-smoke` 安全 skip 与 `codex-app-server` Plane smoke 安全 skip，防止后续只验证 CLI 路径。
- PR #14 已合入 `main`：新增 `worker:contract-smoke`，验证 Control Plane Worker API OpenAPI 文档、run write route handlers 和 idempotency 参数一致；该 smoke 已纳入 `completion:local-smoke` 和 doc/script parity gate。
- 当前分支已把 Worker 进程和 `.env.example` 的默认执行器改为 `WORKER_EXECUTION_ADAPTER=codex-cli`；`mock-openhands` 只保留给显式 smoke/legacy contract，避免实际启动 Worker 时误走测试桩。
- 本轮新增 `codex-app-server` ExecutionAdapter 第一阶段和 `codex:app-server-smoke`，用 fake app-server 覆盖 initialize、thread start、turn start、Codex event、turn completed、conversation ref 和 Development -> Code Review。
- 2026-06-20 已执行真实 Codex Worker smoke：`WORKER_CODEX_REAL_SMOKE_CONFIRM=true pnpm worker:codex-real-smoke` 通过，`execution_adapter=codex-cli`、`codex_mode=real`、`run_id=8b54cdd7-eac9-4fa6-a51b-af85d14e1480`、`codex_events=16`、`marker_verified=true`、`next_state=Code Review`；`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_REAL_SMOKE_CONFIRM=true pnpm worker:codex-real-smoke` 通过，`execution_adapter=codex-app-server`、`codex_mode=real`、`run_id=87505c9e-6833-4f1f-b438-09a8b814773e`、`codex_events=104`、`marker_verified=true`、`next_state=Code Review`；`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true WORKER_CODEX_REAL_SMOKE_CONFIRM=true pnpm worker:codex-real-smoke` 通过，`run_id=ed4078e4-f319-4fde-a4c1-e74bbc775f4b`、`follow_up_run_id=4d19ebe6-403d-4ae7-9583-bcc33024f645`、`codex_events=104`、`follow_up_codex_events=105`、`thread_reused=true`、`marker_verified=true`。这证明临时 DB / git-worktree / Worker / 真实 Codex adapter / Progress / app-server follow-up thread reuse 最小链路可用，不替代真实 Plane task、Plane writeback 或最终 cutover report。
- 曾本地验证 `GET http://127.0.0.1:3112/api/readiness` 返回 200，数据库 connected=true；`GET /api/tasks?limit=20` 和 `GET /api/runs?limit=20` 返回 200。当前未保持 Control Plane dev server 常驻时，`completion:doctor` 会正确报告 `local_probe_control_plane=unreachable` 并提示 `pnpm dev`。
- 本地 `.secrets/completion-final.env` 已刷新为 codex-first 模板；`pnpm completion:doctor` 当前不再把 OpenHands/Langfuse 当作默认缺口，剩余缺口为 Plane/API/operator/secret provider/final evidence 等真实 cutover 变量。2026-06-20 00:03 PDT 记录的 doctor 样本 `completion-doctor-20260620T070307Z-26363` 结果：`ready_count=1`、`missing_count=31`、`manual_missing_variables_count=16`、`manual_placeholder_variables` 包含 Plane/API/operator/secret provider/final evidence 等真实待填项，`manual_not_true_variables=ACP_CUTOVER_LEGACY_POLLER_READONLY,ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED`，两个 cutover gate 变量已存在但仍为 `false`，`hint_confirm_cutover_booleans=true`、Plane 本机探针 reachable、Control Plane 本机探针 reachable；生成的 action plan 在 `reports/completion-doctor-20260620T070307Z-26363.action-plan.md`。同轮 `ACP_SECRET_ENV_FILE=.secrets/completion-final.env pnpm external:preflight` 输出 `external_preflight_id=external-preflight-20260620T070419Z-28212`、`ready_count=1`、`missing_count=31`、`external_smoke_preflight=failed`，失败原因仍是最终 env 中真实 Plane/API/operator/secret provider/人工 cutover evidence 尚未替换模板占位。
- PR #38 已合入 `main`：`runPlaneSync` 现在在 comment polling warning 触发时保留 previous cursor 且不再重复写入同一 cursor；新增 worker-level 单元测试覆盖 clean sync 推进 cursor、warning sync 保留 cursor 两条路径。该增量已通过 `pnpm --filter @agent-control-plane/worker test -- plane-sync`、`pnpm --filter @agent-control-plane/worker typecheck`、`pnpm --silent format` 和 `git diff --check`；同轮 `pnpm completion:doctor` 仍显示剩余缺口只集中在真实 Plane/API/operator/secret provider/final cutover evidence。
- 同轮验证已通过 `pnpm check`、`pnpm --filter @agent-control-plane/db test -- tasks runs`、`pnpm --filter @agent-control-plane/db typecheck`、相关 Prettier check 和 `git diff --check`。
- 2026-06-25 Plane Agent Platform projection contract 增量：ACP `plane:agent-config-sync` 已对齐 Plane fork 当前 `agent_config_outbox` 契约，支持 `agent_user_agent`、`agent_prompt`、`agent_prompt_version`、`agent_prompt_binding`、`agent_role`、`agent_worker_card`、`agent_project_workspace`、`agent_repository`；新增 `acp_role_projections` 和 `acp_repository_projections` migration。该增量已通过 `pnpm build && pnpm test`、`pnpm typecheck`、`pnpm db:validate`、`pnpm format`、`git diff --check`、`pnpm release:image-smoke`，并在临时 PostgreSQL 上从零执行全部 migrations 后运行真实 Plane outbox polling，输出 `plane_agent_config_sync=passed`。

2026-06-20 已完成一次本地 completion gate 验尸：

- `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=false pnpm completion:local-smoke` 通过；同一轮另行执行 `pnpm build` 并通过，因此 CI 的 full build 面也已本地覆盖。
- 2026-06-20 00:00 PDT 在包含 PR #32 内容的代码上再次执行 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=false pnpm completion:local-smoke` 并通过，最终输出 `local_completion_smoke=passed`、`cutover_codex_rehearsal=passed`、`cutover_rehearsal=passed`；Web production build 按显式环境变量跳过，`completion:local-web-build-smoke` 仍覆盖 retry / 非 lock 不重试 / 非法参数拒绝。
- 该聚合命令内已通过 `git diff --check`、脚本语法检查、`doc-script-parity-smoke`、`pnpm check`、`pnpm db:validate`、`pnpm secrets:validate`、Core/DB/Plane build、`operator:query-smoke`、`linear:migrate-smoke`、`plane:human-gate-writeback-smoke`、`worker:contract-smoke`、`worker:codex-plane-smoke` 默认安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server pnpm worker:codex-plane-smoke` 安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm worker:codex-plane-smoke` 安全 skip、`worker:codex-plane-report-smoke`、`openhands:payload-contract`、`task-source:local-smoke`、`cutover:report-smoke`、`external:preflight-smoke`、`completion:doctor-smoke`、`completion:gap-smoke`、`completion:final-env-template-smoke`、`completion:audit-smoke`、`completion:final-smoke`、`completion:local-web-build-smoke`。
- `cutover:codex-rehearsal` 覆盖默认 Codex-first mock Plane、临时 secret provider、provider audit 和 cutover gate，并确认本地 rehearsal report 会被 completion audit 拒绝；`cutover:rehearsal` 当前仍会覆盖 mock OpenHands conversation payload contract，确保 legacy/optional adapter 解析未破；默认 `codex-cli` 最终审计不要求 OpenHands conversation evidence。只有显式选择 legacy OpenHands profile 时，`completion:audit` 才要求真实 cutover report 里的 OpenHands conversation evidence 同时包含非 mock `ui_url`、`conversation_id` 和实际存在、权限为 `0600` 或 `0400` 且通过 `pnpm openhands:payload-contract` 的 `payload_file`。
- 聚合命令默认 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=auto`；若检测到 Next dev lock，会跳过并输出持锁 PID；需要强制纳入同一聚合门禁时，先停止 dev server，再执行 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=true pnpm completion:local-smoke`。若 Next production build 只因瞬时并发 build lock 报 `Another next build process is already running`，聚合门禁会按 `ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES` 做窄重试，真实构建错误仍会失败；`completion:local-web-build-smoke` 已单独覆盖 retry / 非 lock 不重试 / 非法参数拒绝。
- 在 OpenHands adapter 补齐 `openhands.file_operation` 本地摘要分类后，已再次复跑完整 `pnpm completion:local-smoke`，最终输出 `local_completion_smoke=passed`；该增量也已单独通过 `pnpm --filter @agent-control-plane/worker test`、`pnpm --filter @agent-control-plane/worker typecheck`、`pnpm exec prettier --check ...`、`git diff --check ...` 和 `pnpm check`。
- 在 completion audit 补强任务来源 evidence 校验后，已再次复跑完整 `pnpm completion:local-smoke`，最终输出 `local_completion_smoke=passed`。当前默认 `codex-cli` 审计要求 `task_source_evidence` 中 `checked>0`、`linear_urls=0`，并且 Plane URL、repo routing、Control Plane run、Codex `run_events` 和 Progress / Workpad evidence 都必须覆盖每一条 checked 任务；只给一条 run 或事件/进度证据不能覆盖多条任务。OpenHands conversation evidence 和 Langfuse trace evidence 只属于 legacy/optional profile。
- 这次验收只证明本地 harness、单元测试、构建、真实 Codex 本机 smoke 和 mock cutover 编排可闭环；它不是生产完成证据，也不能替代真实 Plane task、Plane writeback、production smoke、task-source、secret provider、provider audit 和最终 cutover report。OpenHands/Langfuse 只在 optional/legacy profile 下另行验收。

## 完成判定矩阵

当前“开发完成”和“产品闭环完成”必须分开判定：

| 层级              | 可接受证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 当前状态           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 本地代码质量      | `pnpm format`、`git diff --check`、`pnpm check`、`pnpm build` 通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 已具备本地门禁     |
| 本地 harness      | `pnpm completion:local-smoke` 通过；该命令聚合脚本语法检查、`doc-script-parity-smoke`、`cutover:rehearsal`、`cutover:report-smoke`、`external:preflight-smoke`、`completion:doctor-smoke`、`completion:gap-smoke`、`completion:final-env-template-smoke`、`completion:audit-smoke`、`completion:final-smoke`、`completion:local-web-build-smoke`、`operator:query-smoke`、`plane:human-gate-writeback-smoke`、`worker:contract-smoke`、`worker:codex-plane-smoke` 默认安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server pnpm worker:codex-plane-smoke` 安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm worker:codex-plane-smoke` 安全 skip、`worker:codex-plane-report-smoke`、`openhands:payload-contract`、`pnpm check`、`pnpm db:validate`、`pnpm secrets:validate`、非 Web 包 build，并在 auto 模式下尽量纳入 Web production build | 已具备本地验证链路 |
| 真实外部预检      | `ACP_SECRET_ENV_FILE=<file> pnpm external:preflight` 输出 `external_smoke_preflight=passed` 且 `missing_count=0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 待用真实配置执行   |
| 真实 cutover gate | `pnpm cutover:check` 通过并保存 `ACP_CUTOVER_REPORT_FILE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 待真实环境执行     |
| 最终完成审计      | `pnpm completion:final` 基于真实外部配置生成并审计 cutover report，且未开启任何 allow/skip 调试开关                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 待真实 report 执行 |

最终完成不得只依赖人工口头确认，也不得只依赖本地 mock rehearsal。完成声明必须同时具备真实 Plane writeback、真实 Codex adapter run、Control Plane run events / Progress / Workpad 证据、production smoke、task-source、secret provider、provider audit、旧 poller 冻结、Linear 归档和 worker crash/budget/workflow evidence。OpenHands 和 Langfuse 不再是默认完成条件，只作为可选增强证据。最终入口优先使用 `pnpm completion:final`，它会按 `external:preflight -> cutover:check -> completion:audit` 顺序执行，并拒绝 allow-missing、allow-incomplete、allow-local-evidence、skip-secret-validate、smoke user write、report overwrite 等调试开关。`completion:final` 会生成本次 `ACP_COMPLETION_FINAL_RUN_ID`、`ACP_EXTERNAL_PREFLIGHT_ID` 和 `ACP_CUTOVER_REPORT_ID`，把 report 路径绑定到 `ACP_COMPLETION_AUDIT_REPORT_FILE`，拒绝 audit report 路径错配、覆盖已存在 report，以及 report 中 final run id、external preflight id 或 cutover report id 与本次调用不一致，避免旧证据被复用为新完成声明。

最近本地证据：2026-06-20 00:00 PDT 已通过 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=false pnpm completion:local-smoke`；该 run 覆盖脚本语法检查、doc/script parity smoke、`pnpm check`、`pnpm db:validate`、`pnpm secrets:validate`、Core/DB/Plane build、Linear migration smoke、OpenHands payload contract、Task Source local smoke、cutover report smoke、external preflight smoke、completion doctor/gap smoke、completion final env template smoke、completion audit/final smoke、Web build retry smoke，并确认 `completion:audit` 会拒绝 rehearsal mock report。这些只证明本地 harness 和构建可用，不替代真实外部 cutover report。

## 已完成能力

### Control Plane 核心

- TypeScript monorepo、Node 24、Next.js Web、Worker、Core、DB、Plane package 已建立。
- Workflow state machine、role routing、repo label fallback、dispatch eligibility 已落地。
- PostgreSQL + Prisma 7 schema 和 migrations 已落地到 `0008_agent_reasoning_high_default`；`gpt-5.5` agent definition 默认 reasoning effort 已切到 `high`。
- Worker 支持 claim lease、heartbeat、自动续租、防重复 claim、retry/backoff、stalled 标记和 lease 过期后重新派发；`pnpm worker:lease-smoke` 已可用本地 mock 长任务验证执行期间多次 heartbeat/lease renewal，`pnpm worker:crash-smoke` 已可用本地 mock 过期 running run 验证 stalled 后 attempt=2 重新认领。
- Development 默认推进到 Code Review，Code Review 默认推进到 Human Review；worker dispatch snapshot 只读取 `Todo`、`Development`、`Code Review`、`In Merge`、`Release Version` 和 `Deployment` 这些自动状态，避免 Backlog / human gate / terminal task 污染 claim 顺序；`pnpm worker:workflow-smoke` 已验证本地 mock 全链路可从 Development 经 Human Review / In Merge / Merged / Release Version / Released / Deployment / Deployed 到 Done。
- `pnpm worker:codex-smoke` 已覆盖 DB-driven Codex Worker run：临时库 + fake Codex CLI 或显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` 的 fake app-server + git-worktree workspace 下，Worker 会认领 Development task、写入 prompt release、`workspace.ready`、Codex events、`conversation_refs(provider=codex-cli|codex-app-server)`、Running / Agent Events / Completed Progress，并推进到 Code Review。
- `codex-app-server` adapter 第一阶段已覆盖 stdio JSON-RPC 生命周期：启动 app-server、发送 `initialize`/`initialized`、创建 thread、启动 turn、消费 turn notifications 和 terminal event，写入 `conversation_refs(provider=codex-app-server)`；`pnpm codex:app-server-smoke` 用 fake app-server 验证该链路。
- Codex CLI adapter 会在写入 `run_events` 前脱敏 stdout JSONL payload、plain stdout 和 stderr，覆盖常见 `token=`、`secret=`、`password=`、`api_key=`、GitHub token、OpenAI-style key 和 Bearer token，并把 `item/agentMessage/delta`、`codex/event/agent_message_delta`、reasoning、command output 和 file change 等 app-server/wrapper 事件归一为可读高信号摘要。
- Worker 会在任务级 `agent_progress` workpad 中持续写入 `Agent Status: Running / Completed / Failed`，任务详情页已单独展示 Progress / Workpad，不再只能从 run detail 反查 agent 是否接单和完成。
- `POST /api/tasks/[taskId]/feedback` 已支持摄取 PR review feedback；默认只写 unresolved feedback，设置 `requestRework=true` 时会复用 rework 流程打回 Development。
- Task Queue / Task Detail 已展示 queue、active run、attempt、lease、retry、成本门禁等调度状态。
- `/api/runs` 和 `/runs` 已支持按 status、repo、role、task identifier 和 limit 筛选执行记录；Run Detail 继续展示 workspace、prompt release、conversation、provider-aware trace refs 和本地事件摘要，并在 Codex / OpenHands / Langfuse 等 provider 返回 UI URL 时提供可点击外链；默认页面不再把 trace 区块硬编码为 Langfuse。

### Prompt 与权限

- Prompt component、binding、release、release component 快照已落地。
- Prompt Binding 支持 pending/active/disabled/rejected 审批态和 RBAC。
- Operator API token、operator password login、signed session cookie、DB-backed user、页面/API ACL 已落地。
- Task 只读观察面面向 viewer 开放；`transition`、`rework`、`feedback` 等任务变更 API 已限制为 owner/admin。
- Audit 查询页、用户管理页、session 管理页已落地。

### Plane 集成

- Plane self-host runbook 和 capability matrix 已沉淀。
- Plane webhook 与 polling sync 已落地。
- Plane sync 支持 cursor、默认 3 次全局 API retry、rate-limit header 退避、非重试型 4xx 快速失败、comment polling 部分失败降级和 warning/critical webhook。
- Plane sync 的 worker-level regression 已覆盖：完全成功时推进最新 task/comment cursor；任一 comment 拉取失败时继续同步可用 task，但保留 previous cursor 且不重复写入未变化 cursor，避免漏读失败 work item 的人工反馈。
- Plane 源码自有 fork 已纳入待办：目标是确认/同步 `michaelx1993/plane`，固定 upstream/version，建立自有部署发布流程，并把 repo 一等字段、agent 状态嵌入等二开需求放入该 fork backlog。
- `pnpm plane:human-gate-writeback-smoke` 已覆盖 Web API 级 human gate writeback contract：`transition`、`rework`、`feedback(requestRework=true)` 会触发 Plane writeback helper，feedback-only comment 不触发 Plane 写入。
- `pnpm plane:writeback-smoke` 已支持 dry-run 读取 states；设置 `PLANE_WRITEBACK_SMOKE_VERIFY_COMMENTS=true` 和 `PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID` 时可只读验证 comments list API；apply 模式可 PATCH work item state、POST comment，并回读验证 state/comment。
- Linear export -> Plane migration 脚本已落地，默认 dry-run，显式 `LINEAR_MIGRATION_APPLY=true` 后写入 Plane。

### OpenHands 集成

- `ExecutionAdapter` 抽象、mock OpenHands adapter、OpenHands Cloud REST adapter、第一阶段 `codex-cli` adapter 已落地。
- Worker 可写入 `conversation_refs`。
- Worker 可写入 adapter event 摘要到 `run_events`；写入本地摘要前会对常见 API key、token、secret、password、Bearer token 和 `sk-*` key 做最小脱敏。
- OpenHands Cloud adapter 会从 conversation payload 的 `events` / `event_log` / `eventLog` / `messages` 中提取 agent message、tool call、file operation、shell、LLM generation、status 摘要，并兼容 `event_log.events` / `items` / `results` / `data` 等常见嵌套列表容器；file operation 会优先识别 read/write/edit/patch/file path/diff 类事件，避免文件读写被淹没在 generic tool call 里；LLM generation 摘要会把字符串或嵌套 chat messages / choices 中的 prompt、input、output、response、completion 规整成脱敏文本，并保留 model、token、cost、latency 和 trace 字段；如果 payload 暴露同源 event log URL/URI，adapter 会额外拉取 event log 并优先用 event log 生成本地摘要；如果 payload 没暴露 URL，可用 `OPENHANDS_EVENT_LOG_PATH_TEMPLATE` 配置同源 event API fallback；拉取失败时写 `openhands.event_log_warning` 并回退到 conversation payload 摘要。
- OpenHands Cloud adapter 会从 conversation payload、同源 event log payload 的 trace 字段，以及 `trace_refs` / `traceRefs` / `traces` 中提取已有 trace 引用并写入本地 `trace_refs`；这只保存外部返回的引用，不伪造 OpenHands 内部逐 LLM call trace。
- OpenHands Cloud adapter 已兼容裸数组、`results` 包装、`data` 包装和单对象响应形态，降低真实 API 分页/包装差异造成的 smoke 失败。
- OpenHands terminal status 到 completion/retry/block 的本地映射已落地，并覆盖常见大小写/同义状态：`finished/completed/succeeded` 成功，`waiting_for_confirmation/requires_confirmation/waiting_for_user` 和 `stuck/blocked/paused` 进入 non-retryable failed，sandbox `error/missing/lost/unavailable/terminated` 及 execution `error/failed/crashed/timeout` 进入 retryable failed，`cancelled/aborted/stopped` 进入 non-retryable failed。
- `pnpm openhands:payload-contract` 可对一份 OpenHands conversation/event log 原始 JSON 做离线契约校验，验证 terminal decision、event summary 类型、trace ref 提取和 secret 脱敏；默认跑 `apps/worker/fixtures/openhands-payload-contract.sample.json`，接入真实 payload 时设置 `OPENHANDS_PAYLOAD_CONTRACT_FILE=/secure/raw-openhands-payload.json`。它是 payload 校准门禁，不调用 OpenHands API，也不替代真实 conversation smoke。
- `pnpm openhands:smoke` 支持只读 probe；设置 `OPENHANDS_SMOKE_CREATE_CONVERSATION=true` 后可创建真实 OpenHands conversation，并输出 conversation id / UI URL；设置 `OPENHANDS_SMOKE_PAYLOAD_FILE=/secure/raw-openhands-payload.json` 后会回读 conversation 和同源 event log，写出权限为 `0600` 的 payload contract JSON，供 `pnpm openhands:payload-contract` 离线校准。
- `pnpm openhands:adapter-smoke` 可直接执行 worker 的 `OpenHandsCloudAdapter.execute()`，验证 terminal status、conversation ref、event summary 和 role next state，不写数据库。
- `pnpm openhands:db-smoke` 可 upsert 一条 Development smoke task，跑一次 worker，并回查 run detail 中的 prompt release、conversation ref、workspace event、OpenHands status event 和 next state；stdout 会输出 `conversation_id`、OpenHands `ui_url`、`prompt_release_id`、`trace_refs` 和首个 `trace_ui_url`，便于真实 cutover evidence 归档；`LANGFUSE_ENABLED=true` 时还会要求写入 `trace_refs(provider=langfuse)`。在带 seed/真实任务的项目中验收时，应使用专用 smoke project，或仅在临时库里设置 `OPENHANDS_DB_SMOKE_ISOLATE_PROJECT=true` 隔离其它自动任务。
- OpenHands conversation smoke、adapter smoke 和 DB smoke 都支持 `ACP_SECRET_ENV_FILE` 和 `ACP_SECRET_COMMAND` 注入 secret。

### Langfuse 集成

- Worker 已接入 Langfuse JS/TS SDK instrumentation 骨架。
- `LANGFUSE_ENABLED=true` 且 credentials 存在时，worker 会创建 run-level `agent-run` observation。
- Worker 可写入 `trace_refs(provider=langfuse)`。
- Langfuse run-level observation input 已包含最终 `renderedPrompt`，output 已包含 run status / summary / failure reason、OpenHands adapter 事件摘要和 adapter 返回的 trace refs，便于在 trace 中查看本次 agent 实际收到的 prompt、最终结果、关键 agent/tool/file/shell 摘要和外部 trace 链接。
- 配置 `LANGFUSE_PROJECT_ID` 后可生成 Langfuse trace UI URL。
- mock adapter trace ref 已支持 run detail 链路展示。
- `pnpm langfuse:smoke` 支持真实发送 Langfuse run-level smoke trace，并输出 `trace_id` / `ui_url`。
- `LANGFUSE_SMOKE_DRY_RUN=true` 只用于本地配置验证；cutover gate 会拒绝用 dry-run 代替真实 Langfuse trace smoke。

### 生产化与运维

- Docker Compose 部署、镜像发布、应用镜像回滚脚本已落地。
- PostgreSQL backup/restore 脚本已落地。
- `pnpm smoke:production` 覆盖 readiness、auth session、runs、tasks、audit events、users 的只读 smoke；readiness 默认要求 `database.connected=true`，避免 Web 存活但数据库断开时误放行；执行时会先加载 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND`，再运行 secret validation，确保真实 cutover env 文件能驱动 production smoke。
- `ACP_SMOKE_EXTERNAL=true` 可启用 Plane/OpenHands/Langfuse 外部依赖只读探针。
- `pnpm secrets:validate`、`pnpm secrets:env-smoke`、`pnpm secrets:provider-smoke`、`pnpm secrets:provider-audit-smoke` 已落地。
- Provider audit smoke 支持 JSONL 文件和 `SECRET_PROVIDER_AUDIT_COMMAND` 两种输入，并检查轮换事件与 secret 泄露。
- `.env.example` 已覆盖 production smoke、external preflight、cutover gate、completion final/audit、worker smoke 临时库隔离等最终门禁变量，便于按样例准备真实 cutover 配置。
- `pnpm linear:migrate-smoke` 已覆盖 Linear export -> Plane import 的本地 dry-run/apply 合约：终态 issue 默认跳过，active issue 会按 Plane state/label 映射创建，缺失 label 会计数提示，迁移 description 会保留原 Linear identifier 和 URL。该 smoke 使用本地 mock Plane，不替代真实 Plane project 迁移验收。
- `pnpm task-source:local-smoke` 已覆盖任务来源审计的本地临时 DB 合约：创建 Plane-routed Development 样本，隔离 seed 自带自动态任务，并要求 Plane URL、repo routing、Control Plane run、Codex run events、Progress / Workpad、prompt release 和 workspace evidence 同时存在。该 smoke 不替代真实 cutover 样本验收。
- `pnpm cutover:check` 已覆盖 production smoke、Plane writeback smoke、Codex Worker evidence、task-source smoke、worker crash recovery smoke、worker budget smoke、worker workflow smoke、secret provider smoke、provider audit smoke、external preflight 和旧 Linear/Symphony poller 切换检查；人工 `*_PASSED=true` 路径必须同时提供对应 evidence URL/记录，自动 smoke 路径会输出 run、work item、任务来源审计、崩溃恢复、预算阻断、完整 workflow、secret provider、provider audit 和 external preflight evidence。OpenHands conversation/adapter/DB run 与 Langfuse trace evidence 只在 legacy/optional profile 中强制。手工 evidence 可来自 `ACP_SECRET_ENV_FILE`，加载后会写入 `ACP_CUTOVER_REPORT_FILE` 的 evidence 摘要。设置 `ACP_CUTOVER_REPORT_FILE=/path/report.json` 时会同时写出机器可读 JSON 报告，记录通过/失败、错误、警告、smoke 开关和 evidence 摘要；已存在 report 默认拒绝覆盖，只有 `ACP_CUTOVER_REPORT_OVERWRITE=true` 才允许替换。
- `pnpm cutover:report-smoke` 已覆盖失败路径 report：缺配置时 `cutover:check` 必须退出非 0、输出 `cutover_readiness=failed`、写出权限为 `0600` 的 JSON report，并保留 `reportId`、`completionFinalRunId`、errors、warnings、gates、smoke、evidence 和 config。该 smoke 还会验证已有 report 默认不会被覆盖、显式 `ACP_CUTOVER_REPORT_OVERWRITE=true` 才允许复写、最终 env 模板占位符、Plane base URL loopback、人工 OpenHands/Langfuse loopback URL、production smoke 命令失败都会被 `cutover:check` 拒绝，验证手工 evidence 从 `ACP_SECRET_ENV_FILE` 加载后会进入 cutover report，以及 `smoke:production` 会先加载 `ACP_SECRET_ENV_FILE` 再执行 secret validation；production smoke 失败时 report 必须记录 `smoke: production smoke failed`，且不能合成部分 production evidence。`ACP_CUTOVER_REPORT_ID` 可用于把 report 绑定到外部变更单、final run 或 cutover issue；`.env.example` 已列出该变量，留空时由脚本生成非敏感 report id。
- `pnpm cutover:codex-rehearsal` 已覆盖本地 mock Plane + 临时数据库的 Codex-first cutover gate 编排：自动执行 Plane writeback、Codex adapter、task-source、worker crash/budget/workflow、secret provider 和 provider audit smoke，并验证 OpenHands/Langfuse legacy smoke 不参与默认 profile；该 report 仍必须被 `completion:audit` 拒绝，避免把本地 mock 当作生产完成证据。
- `pnpm cutover:rehearsal` 已覆盖本地 mock Plane writeback、legacy OpenHands conversation/adapter/DB run、Langfuse trace、worker budget、临时 secret provider smoke 和 provider audit smoke；该脚本显式使用 `legacy-openhands` profile，这些 mock/legacy 链路只验证 harness 契约，不是 Codex-first 生产批准信号。rehearsal 的 secret provider smoke 使用临时 dotenv，不代表真实供应商 provider 已验收，并会额外确认 `completion:audit` 拒绝 rehearsal report。设置 `ACP_CUTOVER_REHEARSAL_REPORT_FILE=/path/report.json` 时保留该报告。
- `pnpm worker:lease-smoke` 已覆盖本地 mock 长任务 lease renewal smoke：默认创建临时数据库、迁移、seed，执行延迟 mock adapter，并要求至少两个 heartbeat 事件。
- `pnpm worker:crash-smoke` 已覆盖本地 mock 崩溃恢复 smoke：默认创建临时数据库、迁移、seed，插入一条过期 running run，要求 worker 将旧 run 标记为 stalled，并以 attempt=2 重新认领同一任务推进到 Code Review。
- `pnpm worker:budget-smoke` 已覆盖本地 mock 预算门禁 smoke：默认创建临时数据库、迁移、seed，插入一条超过单 run 预算的 Development task，要求 worker 不 claim、不创建 run，而是自动切到 Blocked 并写入预算超限 Progress / Workpad。
- `pnpm worker:codex-smoke` 已覆盖本地 Codex Worker DB smoke：默认创建临时数据库、迁移、seed，使用 fake `codex exec --json` 走真实 Worker `runOnce()`；显式设置 `WORKER_EXECUTION_ADAPTER=codex-app-server` 时会改用 fake app-server，验证 workspace、prompt release、Codex event、conversation ref、任务级 Agent Events Progress 和 Development -> Code Review。
- `pnpm worker:codex-real-smoke` 是显式 opt-in 的真实 Codex Worker smoke：必须设置 `WORKER_CODEX_REAL_SMOKE_CONFIRM=true`，会调用本机真实 Codex，默认 `WORKER_CODEX_MODEL=gpt-5.5`、`WORKER_CODEX_REASONING_EFFORT=high`，在临时 repo 中创建 marker 文件并验证真实 Codex 输出链路；默认 `codex-cli`、显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` 单 turn，以及 `WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true` 两轮 follow-up 均已在 2026-06-20 跑通。该模式会消耗 Codex 额度，本机额度不足时会明确输出失败原因。
- Worker 已支持同一 task 的 previous conversation 注入：下一次 run 会读取该 task 最近一条同 execution adapter 的 `conversation_ref`；`codex-app-server` adapter 会从 `process://codex-app-server/threads/<thread>/turns/<turn>` 或 `<thread>/turns/<turn>` 格式恢复 thread id，并写入 `codex.thread_reused` 事件。Worker loop 会复用单个 adapter 实例；`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true pnpm worker:codex-smoke` 已用临时 DB 验证同一 fake app-server 进程可处理同一 task 的 Development 和 Code Review 两个 turns，第二次 run 写入 `codex.thread_reused` 并复用同一 thread id；同样的 follow-up 链路也已用本机真实 Codex 跑通。真实 Plane task 的跨 turn 长会话仍需在 Plane 派发路径验收。
- `pnpm worker:codex-plane-smoke` 是显式 opt-in 的真实 Plane + Codex 写回 smoke：未设置 `WORKER_CODEX_PLANE_SMOKE_APPLY=true` 时只做安全 skip；真实 apply 模式要求已有 Control Plane Web/API、`CONTROL_PLANE_BASE_URL`、`ACP_WORKER_API_TOKEN`、`WORKER_CODEX_PLANE_SMOKE_TEMP_DB=false`、可派发的 Plane-routed task，以及 `AGENT_WORKER_REPO_PATH` 指向的 split `michaelx1993/agent-worker` checkout。脚本会用 HTTP Worker claim/run/complete，并在提供 `DATABASE_URL` 时回查任务 URL、`codex.*` run events、Running / Agent Events / Completed Progress，输出 `run_id`、`task_identifier`、`repository_slug`、`role` 和 evidence 计数。设置 `WORKER_CODEX_PLANE_SMOKE_REPORT_FILE` 后，成功路径会写出权限为 `0600` 的 JSON evidence report；已有 report 默认拒绝覆盖，只有 `WORKER_CODEX_PLANE_SMOKE_REPORT_OVERWRITE=true` 才允许复写；`pnpm worker:codex-plane-report-smoke` 已离线验证 report 字段、权限和覆盖保护。`PLANE_BASE_URL`、`PLANE_WORKSPACE_SLUG`、`PLANE_PROJECT_ID`、`PLANE_API_KEY` 只在 `WORKER_CODEX_PLANE_SMOKE_REQUIRE_PLANE_ENV=true` 时强制。设置 `WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true` 时，脚本会要求真实 follow-up run 产生 `codex.thread_reused` event 和 `codex-app-server` conversation ref；它不再在 smoke 内模拟 review 打回。
- `pnpm worker:workflow-smoke` 已覆盖本地 mock workflow 全链路 smoke：默认创建临时数据库、迁移、seed，自动执行 Development / Code Review / In Merge / Release Version / Deployment 五个 agent run，中间用 `transitionTaskState` 模拟人工 gate，最终进入 Done。
- `pnpm worker:workflow-smoke` 同时要求每个自动 run 至少写入 Running 和 Completed 两条 task-level `agent_progress`，验证 Progress / Workpad 最小链路。
- Dashboard 已展示 queue、active runs、human gates、blocked、stalled、retry backlog、24h 成功/失败、token/cost 和 12h/24h/7d 趋势。
- 监控阈值支持 DB 动态配置优先、环境变量兜底。
- Worker 支持 generic/slack/email webhook 告警通知和失败重放队列。
- Plane sync 支持可选服务端 delta：`PLANE_SYNC_SERVER_DELTA=true` 时会把 project cursor 作为 `updated_after` 传给 Plane work item list API；目标 Plane 不支持时会回退全量 polling。任务 upsert 可使用 delta 结果，comment polling 仍会扫描全量 work item id，避免旧 work item 的新 comment 因 issue `updated_at` 未变化而漏读。
- 单 run 估算成本门禁已可见化：超过 `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` 或 `dispatch.max_estimated_cost_usd_per_run` 的任务会自动进入 `Blocked`，并写入任务级 Progress / Workpad 说明预算超限原因。

### Workspace

- Worker 支持 `auto`、`local-path`、`ephemeral`、`git-worktree` 四种 workspace 策略。
- `git-worktree` 会基于 repository `local_path` 创建 per-run worktree。
- `pnpm worker:workspace-smoke` 已验证本地 worker run 在 `git-worktree` 策略下会创建 per-run worktree、写入 `workspace.ready`，并把 workspace path/strategy 注入 mock adapter。
- `pnpm workspace:cleanup` 支持 dry-run/apply；`pnpm workspace:cleanup-smoke` 已验证 dry-run 不删除、apply 删除 workspace、标记 cleaned 并写入 `workspace.cleaned` 事件。
- apply 模式下，`git-worktree` cleanup 优先执行 `git worktree remove --force` 和 `git worktree prune`，失败时 fallback 到目录删除。

## 未完成或未真实验收

- 已用本机 self-host Plane task + split HTTP Worker + `WORKER_EXECUTION_ADAPTER=codex-cli` 跑通 Development -> Code Review -> Human Review 样本；`worker:codex-plane-smoke` 已能写出成功 JSON evidence report。2026-06-20 复测发现 split Worker 只通过 Worker API 写入 `workspace.ready` run event，Control Plane 未同步归档到 `workspaces` 表，导致真实 `pnpm task-source:smoke` 缺 workspace evidence；当前已修复 Worker events route，收到有效 `workspace.ready` payload 时会在同一幂等写链路内 upsert `workspaces`。复测 `TOKEN-3` 真实 Plane-routed Development run 后，`pnpm task-source:smoke` 输出 `checked=1`、`routed_count=1`、`run_evidence_count=1`、`run_event_count=1`、`progress_item_count=1`、`prompt_release_count=1`、`workspace_count=1`、`violations=0`、`task_source_smoke=passed`。
- 尚未用真实 Plane task 或真实业务长任务返回校准 `run_events` / Progress / Workpad / Run Detail 的事件分类、截断策略和噪声过滤；`codex-app-server` previous thread resume、Worker loop adapter 复用和 persistent app-server follow-up 已有 fake 与本机真实 Codex 临时 DB 验证，仍未证明真实 Plane 派发路径下的跨 turn 长会话复用。
- 尚未用真实 cutover report 验证默认 `codex-cli` profile 下的 Codex run evidence、Plane writeback、task-source、secret provider 和 provider audit。
- OpenHands/Langfuse 真实 smoke、payload 校准、UI 跳转和逐 LLM call trace 只属于 optional/legacy profile 验收项，不阻断第一版 Codex-first 完成。
- 尚未在真实 Plane project 上复测人工 gate 状态/comment writeback；本地 API 级 contract 已由 `pnpm plane:human-gate-writeback-smoke` 覆盖。
- 尚未在真实 Plane project 上验证 `PLANE_SYNC_SERVER_DELTA=true` 是否能稳定减少 work item list 返回量；本地契约已覆盖“任务 delta + 全量 comment 扫描”，防止旧 work item 的新 comment 因 issue `updated_at` 未变化而漏读。
- 尚未完成真实生产数据库迁移部署和完整 cutover 演练。
- 尚未用真实 secret provider command 跑通 provider smoke。
- 尚未用真实供应商账号/API 拉取 audit events 并跑通 provider audit smoke。
- 多 repo 公平队列已有本地 smoke 验证：`pnpm worker:fairness-smoke` 会在临时库插入两个 repo 的任务，确认 `repo_fair` 策略按 repo 轮转并让 dispatch claim 顺序跟随轮转；尚未用生产数据调优多 worker、公平队列权重和成本门禁阈值。

## 验收分层

### 本地代码门禁

只证明代码、类型、构建和静态格式没有明显破损：

```bash
pnpm format
git diff --check
pnpm check
pnpm build
```

### Harness 级 smoke

证明各条链路的脚本和 API adapter 能按预期运行，但默认不等于真实生产验收：

```bash
pnpm completion:local-smoke
pnpm smoke:production
pnpm plane:live-smoke
pnpm plane:human-gate-writeback-smoke
pnpm plane:writeback-smoke
pnpm openhands:smoke
pnpm openhands:payload-contract
pnpm codex:app-server-smoke
pnpm worker:codex-smoke
pnpm openhands:adapter-smoke
pnpm langfuse:smoke
pnpm secrets:provider-smoke
pnpm secrets:provider-audit-smoke
pnpm completion:gap-smoke
pnpm completion:final-env-template-smoke
pnpm completion:audit-smoke
pnpm completion:final-smoke
pnpm external:preflight
pnpm external:preflight-smoke
```

`pnpm completion:local-smoke` 是本地门禁聚合命令，会执行 `git diff --check`、脚本语法检查、`doc-script-parity-smoke`、`pnpm check`、`pnpm db:validate`、`pnpm secrets:validate`、Core/DB/Plane build、`operator:query-smoke`、`linear:migrate-smoke`、`plane:human-gate-writeback-smoke`、`worker:contract-smoke`、`worker:codex-plane-smoke` 默认安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server pnpm worker:codex-plane-smoke` 安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm worker:codex-plane-smoke` 安全 skip、`openhands:payload-contract`、`task-source:local-smoke`、`cutover:report-smoke`、`external:preflight-smoke`、`completion:doctor-smoke`、`completion:gap-smoke`、`completion:final-env-template-smoke`、`completion:audit-smoke`、`completion:final-smoke`、`completion:local-web-build-smoke`。`operator:query-smoke` 会在临时 PostgreSQL 数据库上执行真实 operator task/run 查询，覆盖 enum/text 兼容问题。`worker:contract-smoke` 会验证 Control Plane Worker API OpenAPI 文档、run write route handlers 和 idempotency 参数一致。`codex:app-server-smoke` 会用 fake app-server 验证 Codex app-server JSON-RPC 生命周期和事件落库前摘要转换。`cutover:codex-rehearsal` 使用本地 mock Plane 和默认 `codex-cli` profile 验证 Codex-first cutover gate，并确认 mock report 被 audit 拒绝；`cutover:rehearsal` 显式使用 `legacy-openhands` profile，覆盖可选 legacy gate 编排。`doc-script-parity-smoke` 会静态检查 package 中 completion/cutover/smoke 入口在文档中可见，并检查 local completion smoke 的内部步骤仍出现在 runbook/status 清单中。默认 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=auto`：未检测到 `apps/web/.next/dev/lock` 时会自动执行 Web production build；若本地 Next dev server 持有 lock，则跳过并输出持锁 PID。设置为 `true` 会强制执行 Web build，dev lock 存在时阻断；设置为 `false` 会始终跳过。Web production build 遇到瞬时 Next 并发 build lock 时默认重试 1 次，可用 `ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES` 和 `ACP_LOCAL_COMPLETION_WEB_BUILD_RETRY_DELAY_SECONDS` 调整；非 lock 构建失败不重试；`completion:local-web-build-smoke` 会单独验证 retry / 非 lock 不重试 / 非法参数拒绝。该命令仍只证明本地 harness，不替代真实外部 cutover report。

`pnpm external:preflight` 已支持默认 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 路径，预检默认要求 Codex adapter、Plane writeback、task-source、secret provider、provider audit、旧 poller 冻结和 Linear 归档；显式选择 legacy external profile 时才检查 OpenHands/Langfuse。它仍会安全加载 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND`、拒绝 shell command substitution、拒绝模板占位符、输出非敏感缺口报告，并为 cutover report 绑定 preflight id。预检 JSON report 的模板下一步命令会跟随目标 env 文件状态：文件已存在时输出 `ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true`。

`pnpm completion:gap` 是当前环境缺口报告入口。它会以 allow-missing 模式执行 `external:preflight`，默认写入 `reports/completion-gap-<timestamp>.json`；若未显式设置 `ACP_SECRET_ENV_FILE` 且默认 `.secrets/completion-final.env` 存在，它会自动加载该文件用于诊断缺口，避免 operator 忘记带 env 后看到全量空缺；可用 `ACP_COMPLETION_GAP_USE_DEFAULT_ENV_FILE=false` 关闭，或用 `ACP_COMPLETION_GAP_DEFAULT_ENV_FILE` 改默认路径。它会输出当前 `ACP_SECRET_ENV_FILE` 状态、默认 `.secrets/completion-final.env` 是否存在、`default_final_env_file_hint`、ready/missing 计数、占位符/缺变量/不安全 URL 计数、缺口变量名清单、`completion_final_auto_bound_missing_variables`、`manual_missing_variables`、manual 变量按 `missing_required` / `placeholder` / `not_true` / `unsafe_url` / `other` 拆分的清单、每个验收 scope 的 `scope=<name>;status=<status>;ready=<n>;missing=<n>` 摘要，以及生成 `.secrets/completion-final.env` 或对既有 env 执行 append-missing、带 `ACP_SECRET_ENV_FILE` 执行 `external:preflight`、复跑 `completion:gap` 和执行 `pnpm completion:final` 的下一步命令；若当前已显式设置 `ACP_SECRET_ENV_FILE`，终端、JSON report 和 action plan 中的 external preflight/复跑/最终命令会沿用该路径；JSON report 会保留 `external:preflight` 原有分项 smoke nextCommands，并只规范其中的 external preflight/gap/final env 路径。默认还会写出权限为 `0600` 的 `reports/<gap-id>.variables.txt`、`reports/<gap-id>.variables.tsv`、`reports/<gap-id>.checklist.md` 和 `reports/<gap-id>.action-plan.md`，并在终端输出 JSON report、variables、matrix、checklist 和 action plan 的 `600` mode；JSON report 的 `generatedArtifacts` 也会写入 artifact 路径、缺口变量列表、auto-bound/manual 变量计数和 manual reason 分组，TSV 字段为 `variable / scopes / reason_types / missing_count`，Markdown checklist 按 scope 生成可勾选缺口项，并单列 `completion:final` 会自动绑定的 final run id、external preflight id、cutover report id、cutover report path，以及 final wrapper 会强制默认的 Codex-first 最终 smoke / adapter / writeback 开关，并把 OpenHands/Langfuse 仅作为 legacy optional 开关列出；manual 变量 reason 分组只保留操作者必须真实填写的变量；action plan 按 operator sequence、auto-bound 变量、manual 变量和 scope 优先级组织下一步执行顺序，可用 `ACP_COMPLETION_GAP_VARIABLES_FILE` / `ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE` / `ACP_COMPLETION_GAP_CHECKLIST_FILE` / `ACP_COMPLETION_GAP_ACTION_PLAN_FILE` 改路径；它不会把失败预检伪装成完成证据。需要在终端直接展开每条缺口时设置 `ACP_COMPLETION_GAP_SHOW_MISSING=true`；本地契约验证用 `pnpm completion:gap-smoke`。

`pnpm completion:doctor` 是 `completion:gap` 之上的一屏诊断命令。它会安全读取最终 env 文件状态，输出 manual/auto-bound 缺口、`gap_scope_summary`、每个 `gap_scope_<scope>_status/ready/missing`、`manual_placeholder_variables`、`manual_not_true_variables`、关键 URL 变量和关键 manual 变量的 `missing/placeholder/set` 状态、OpenHands/Langfuse 在默认 `codex-cli` profile 下的 `optional_missing/optional_placeholder/optional_set` 状态、cutover 人工确认开关的 `missing/placeholder/false/true` 状态、本机 Plane/Control Plane/OpenHands/Langfuse 只读探针结果、`hint_fill_manual_variables`、`hint_replace_placeholders`、`hint_confirm_cutover_booleans`、`hint_start_control_plane`、artifact 路径和下一步命令。doctor 会继承 `completion:gap` 的 `next_command_generate_env_template`；当 final env 文件已存在时，该命令会带 `ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true`；也会输出 `next_command_view_action_plan` / `next_command_view_checklist` / `next_command_view_variable_matrix`，便于直接打开本次生成的 operator action plan、checklist 和 TSV matrix；`next_command_show_missing` 可用 `ACP_COMPLETION_GAP_SHOW_MISSING=true` 直接展开每条缺口。doctor 不打印 secret 值、不执行写入、不替代真实 smoke；它用于判断当前卡在“未填 env”“占位符未替换”“人工 gate 未确认”“本机服务未启动”还是“可以进入 external:preflight / completion:final”。当本机 Control Plane readiness 不可达时，它会输出 `hint_start_control_plane_command=pnpm dev`。

`pnpm completion:final-env-template` 当前默认生成 `codex-cli` profile 模板，预填 Codex adapter、Plane writeback、task-source、secret provider、provider audit、本地 completion evidence 和两个人工 cutover gate 相关变量；`ACP_CUTOVER_LEGACY_POLLER_READONLY` / `ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED` 在模板中默认为 `false`，必须在取得真实证据后显式改为 `true`。已有 env 文件默认拒绝覆盖；若 `.secrets/completion-final.env` 是旧模板，可用 `ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=.secrets/completion-final.env ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template` 只追加缺失变量并保留已有值。OpenHands/Langfuse 配置保留为注释形式的 legacy profile 选项。

### Cutover gate

`pnpm cutover:check` 是上线前阻断门禁。只有显式打开对应 `ACP_CUTOVER_RUN_*` 开关时，才会在 gate 内真实执行 production、Plane writeback、task-source、worker crash recovery、worker budget、worker workflow、secret provider、provider audit smoke 和 external preflight。默认 `codex-cli` profile 要求 Codex Worker run evidence、Control Plane run events、Progress / Workpad、Plane writeback evidence、task-source evidence、旧 poller 停用/只读证据和 Linear 归档证据；OpenHands conversation URL 和 Langfuse trace URL 只在 legacy external profile 中强制。`PLANE_BASE_URL` 和 legacy 人工 OpenHands/Langfuse URL 不能指向 `localhost`、`127/8`、`0.0.0.0` 或 `::1`。设置 `ACP_CUTOVER_REPORT_FILE` 后，gate 成功或失败都会写 JSON 报告，便于保存 cutover 证据；默认拒绝覆盖已有 report，即使 report path 来自 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND` 也会在 secret 加载后检查，只有受控复跑时才设置 `ACP_CUTOVER_REPORT_OVERWRITE=true`。

`pnpm completion:audit` 已改成 profile-aware。默认 `codex-cli` audit 会审计 Codex adapter evidence、Plane writeback、production smoke、task-source、secret provider、provider audit、旧 poller 冻结、Linear 归档和 worker crash/budget/workflow evidence；OpenHands payload/adapter/DB run/Langfuse trace 只在 legacy external profile 下强制。report id 绑定、权限检查、占位符拒绝、本地 rehearsal 拒绝和旧证据防复用逻辑保留。

`pnpm completion:final` 当前默认 profile 为 `codex-cli`，仍按 `external:preflight -> cutover:check -> completion:audit` 生成绑定到同一 final run id 的 report；dry-run 和执行前提示会输出生成最终 env 模板或 append-missing 的下一步命令；OpenHands/Langfuse 只在显式选择外部 profile 时启用。

推荐顺序是先执行 `pnpm external:preflight`，确认真实 cutover 所需配置齐全；再执行 `pnpm completion:final` 一次性生成并审计真实 report。若需要分步排错，再拆成 `pnpm cutover:check` 和 `pnpm completion:audit`。`external:preflight` 当前是配置预检，不替代 cutover report，也不替代 completion audit。

### 任务来源切换验收

“新任务只从 Plane/Control Plane 派发”不是一句配置声明，必须用数据和操作记录同时证明：

- 旧 Linear/Symphony poller 已停止、禁用或进入只读，且有命令输出、进程列表、服务状态或部署记录。
- Linear 只作为历史归档，不再作为 worker polling source。
- 新建测试任务必须先出现在 Plane work item 中，再由 `pnpm plane:sync` 或 Plane webhook 写入 Control Plane `tasks`。
- `pnpm plane:sync` 的 polling fallback 已支持结构化 Plane API error，默认重试 3 次，并会按 `Retry-After` / `X-RateLimit-Reset` 退避；真实 cutover 时仍应优先依赖 webhook，避免撞上 Plane API 60 rpm 限制。
- Control Plane `tasks.url` 应指向 Plane work item；非终态自动派发任务不应再指向 Linear URL。
- 新任务必须有 `repo:<slug>` label 或正式 repo 字段，且同步后 `repository_id` 不为空。
- Worker claim/run 证据应来自 Control Plane `runs` / `run_events`，执行证据默认落到 Codex run events、Progress / Workpad、prompt release 和 workspace；OpenHands conversation 和 Langfuse trace 仅作为可选增强。
- Plane state/comment writeback 应能在 Plane UI 中回读；Linear 不再收到 agent 进度状态更新。

当前已提供 `pnpm task-source:smoke` 作为任务来源只读审计脚本，默认审计非终态自动派发任务，阻断 Linear URL、缺 Plane URL、缺 repo routing。默认 `codex-cli` profile 要求 Control Plane run、Codex run events、Progress / Workpad、prompt release 和 workspace 证据；conversation/trace 证据只在 legacy external profile 中作为可选/强制项。cutover gate 设置 `ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE=true` 后会自动执行同样的来源审计。本地可用 `pnpm task-source:local-smoke` 验证审计契约和 evidence 结构；完整 cutover 演练仍建议保留人工页面抽查，但不能用人工抽查替代自动门禁。

### Worker lease smoke

`pnpm worker:lease-smoke` 会默认创建临时数据库、执行 migration/seed，然后用 `mock-openhands` 延迟执行模拟长任务，验证 worker 在 adapter 执行期间会持续写 heartbeat 并刷新 lease。它证明本地 lease renewal 机制可用，不证明真实 Codex 长任务或崩溃恢复已经验收。设置 `WORKER_LEASE_SMOKE_TEMP_DB=false` 时才会复用当前 `DATABASE_URL`。

### Worker crash recovery smoke

`pnpm worker:crash-smoke` 会默认创建临时数据库、执行 migration/seed，然后插入一条 heartbeat 和 lease 都已过期的 `running` run，模拟 worker 崩溃遗留的占用。脚本要求下一轮 worker 先把旧 run 标记为 `stalled`，再以 `attempt=2` 重新认领同一任务并推进到 `Code Review`。它证明本地 lease 过期恢复机制可用，不证明真实 Codex 进程崩溃、真实 workspace 残留清理或真实外部 writeback 已完成验收。设置 `WORKER_CRASH_SMOKE_TEMP_DB=false` 时才会复用当前 `DATABASE_URL`。

### Worker budget smoke

`pnpm worker:budget-smoke` 会默认创建临时数据库、执行 migration/seed，然后插入一条带 `cost:<usd>` 且超过 `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` 的 `Development` 任务。脚本要求 worker 跳过 claim、不创建 run、把任务切到 `Blocked`，并写入包含 `Agent Status: Blocked.` 的任务级 `agent_progress`。它证明本地预算门禁和可见化阻断链路可用，不证明真实成本估算已经准确，也不替代人工拆分高成本任务。设置 `WORKER_BUDGET_SMOKE_TEMP_DB=false` 时才会复用当前 `DATABASE_URL`。

### Worker workflow smoke

`pnpm worker:workflow-smoke` 会默认创建临时数据库、执行 migration/seed，然后用 mock adapter 从 `Development -> Code Review -> Human Review -> In Merge -> Merged -> Release Version -> Released -> Deployment -> Deployed -> Done` 跑完整条状态机。自动节点由 worker 执行，人工 gate 由 `transitionTaskState` 模拟人工批准；脚本同时要求每个自动 run 至少写入 Running 和 Completed 两条任务级 `agent_progress`。它证明本地状态机、worker 自动推进、人工 gate 转换和 Progress / Workpad 最小链路能闭环，不证明真实 Plane 人工回写或真实 Codex 执行已验收。设置 `WORKER_WORKFLOW_SMOKE_TEMP_DB=false` 时才会复用当前 `DATABASE_URL`。

### 本地 cutover rehearsal

`pnpm cutover:codex-rehearsal` 会启动临时 mock Plane、临时数据库和 Codex-first cutover gate，执行 Plane writeback、Codex adapter、task-source、worker crash/budget/workflow、secret provider 和 provider audit smoke。它证明默认 Codex-first gate 编排可在本地闭环，并验证 OpenHands/Langfuse legacy smoke 不参与默认 profile；它不证明真实外部账号、真实 Plane 项目、真实 Codex run 或真实 production smoke 已验收。该 rehearsal report 仍必须被 `completion:audit` 拒绝。

`pnpm cutover:rehearsal` 会启动临时 mock Plane/OpenHands/Langfuse 服务，并显式用 `legacy-openhands` profile 调用 `pnpm cutover:check`。它证明本地 legacy gate 编排和 smoke 脚本契约没有破损，不证明真实外部账号、真实 Plane 项目、真实 Codex run，或真实 OpenHands/Langfuse UI 已验收。默认 `codex-cli` 完成口径仍以 Codex adapter evidence、Control Plane run events、Progress / Workpad、Plane writeback 和 task-source evidence 为主；rehearsal 中的 DB-driven OpenHands smoke 只保留为 legacy adapter contract 覆盖。设置 `ACP_CUTOVER_REHEARSAL_TEMP_DB=false` 会直接复用 `DATABASE_URL`，要求目标库已完成 migration/seed。rehearsal 会显式设置 `ACP_CUTOVER_ALLOW_LOOPBACK_URLS=true`，只允许本地 mock 服务通过 cutover gate；最终 `pnpm completion:final` 会拒绝该开关。rehearsal 会生成临时 dotenv 并执行 secret provider smoke，校验 cutover JSON report 中的 readiness、smoke flags 和关键 evidence；但该 provider evidence 只证明脚本契约，不证明真实供应商 provider。rehearsal report 仍必须被 `completion:audit` 拒绝。设置 `ACP_CUTOVER_REHEARSAL_REPORT_FILE` 可保留报告。

### 完整 cutover 演练

完整演练目前仍未完成，不能只看 `cutover_readiness=passed`。演练必须在真实或 staging 环境走完：

- 旧 Linear/Symphony poller 停止或只读。
- Linear export 迁移到 Plane，并保留原 identifier/url/description。
- `pnpm plane:sync` 后本地 `tasks` 有 repo routing。
- 新任务只从 Plane/Control Plane 派发，并留下 Plane work item URL、Control Plane task/run、Codex run events、Progress / Workpad 和旧 poller 停用证据。
- Development run 由 Worker 的 `codex-cli` adapter 执行，并产生 run events / Progress / Workpad 摘要。
- OpenHands conversation 与 Langfuse trace 只作为可选增强证据，不再是第一版完整演练必需条件。
- Human gate / rework 状态和 comment 可回写 Plane。
- Linear 只作为归档，不再作为 agent 任务源。

## 当前验收命令

本地代码质量：

```bash
pnpm format
git diff --check
pnpm check
pnpm build
```

生产前基础检查：

```bash
pnpm external:preflight
pnpm completion:gap
pnpm completion:local-smoke
pnpm secrets:validate
pnpm secrets:env-smoke
pnpm smoke:production
pnpm task-source:smoke
pnpm cutover:check
pnpm cutover:report-smoke
pnpm cutover:rehearsal
pnpm completion:audit
pnpm completion:final
pnpm worker:lease-smoke
pnpm worker:crash-smoke
pnpm worker:budget-smoke
pnpm worker:workflow-smoke
```

Plane writeback smoke：

```bash
pnpm plane:human-gate-writeback-smoke
pnpm plane:writeback-smoke
```

可选 OpenHands / Langfuse smoke：

```bash
pnpm openhands:smoke
pnpm openhands:payload-contract
pnpm openhands:adapter-smoke
pnpm openhands:db-smoke
pnpm langfuse:smoke
```

Secret provider smoke：

```bash
pnpm secrets:provider-smoke
pnpm secrets:provider-audit-smoke
```

Workspace cleanup：

```bash
pnpm workspace:cleanup
pnpm workspace:cleanup-smoke
```

## 下一批推荐任务

1. 用真实 Plane test task 验证默认 `WORKER_EXECUTION_ADAPTER=codex-cli`，并按需复测 `WORKER_EXECUTION_ADAPTER=codex-app-server`，跑通一条 Development run。
2. 用真实 Codex event stream 校准 `run_events` 和任务级 Progress / Workpad 的事件分类、截断策略和噪声过滤。
3. 用真实 cutover report 复测 `completion:final` / `completion:audit` / `external:preflight` 的默认 `codex-cli` profile，覆盖 `codex-cli` 或 `codex-app-server` adapter、Codex run events、Progress/Workpad、Plane writeback、task-source、secret provider 和 provider audit；OpenHands/Langfuse smoke 只在显式开启 optional/legacy profile 时执行。
4. 用真实 Plane test work item 跑通 `PLANE_WRITEBACK_SMOKE_APPLY=true pnpm plane:writeback-smoke`；本地 API contract 可先用 `pnpm plane:human-gate-writeback-smoke` 快速回归。
5. 用真实 secret provider command 跑通 `pnpm secrets:provider-smoke`。
6. 用真实供应商账号/API 跑通 `pnpm secrets:provider-audit-smoke`。
7. 做一次完整 cutover 演练：冻结旧 Symphony poller、迁移任务、Plane sync、真实 Codex Development run、Plane writeback 抽查、task-source 审计和 `pnpm completion:final`，并确认新任务只从 Plane/Control Plane 派发。
