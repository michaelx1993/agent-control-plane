# TODO

本文记录当前 Agent Control Plane 方案的明确待办。更详细的背景见 `agent-control-plane-prd.md`、数据边界见 `agent-control-plane-erd.md`、阶段路线见 `agent-control-plane-roadmap.md`。

## 技术基线

### 全局约束

- Runtime：Node 24。
- Language：TypeScript。
- Package manager：pnpm 11。
- Formatting：Prettier。
- Tests：Vitest。
- Build/typecheck：TypeScript 5.9，所有包必须提供 `typecheck` 或等价 `check`。
- Web framework：Next.js 16 + React 19，仅用于 Control Plane operator UI 和 HTTP API。
- Database：PostgreSQL；schema/migration 使用 Prisma，运行时查询优先使用 `pg` 和显式 SQL。
- Local dev：Docker / Docker Compose；本地端口和 env 必须在文档或 `.env.example` 中可发现。
- Source ownership：生产必需组件只从 `michaelx1993/*` 自有源码仓库构建。
- Deployment：每个运行仓库必须有 Dockerfile 或 Compose 发布入口、CI release gate、tag 策略和回滚说明。
- Secrets：不把 secret 写进仓库；运行时通过 env file 或 secret provider command 注入。
- Auth：内部服务默认使用 bearer token；后续可升级 mTLS，但第一版不引入额外复杂度。
- Observability：默认使用 Control Plane 本地 run events、Progress / Workpad、audit events 和 logs；OpenHands/Langfuse 只作为 optional/legacy。
- Paid dependencies：必需链路不依赖付费 SaaS 或付费 agent 平台；OpenAI/Codex 模型调用成本除外。

### 必要技术清单

#### Plane Self-host

- 基线：fork 官方 Plane 到 `michaelx1993/plane`，以 upstream release/commit 固定版本。
- 部署：Docker Compose first；保留后续迁移到单机 systemd 或 Kubernetes 的空间。
- 二开重点：work item repo 字段、agent 状态展示、run/progress 链接、webhook 与 API 行为验证。
- 数据边界：Plane 使用自己的数据库；不直接访问 Control Plane DB，不承载 agent 编排逻辑。

#### Agent Control Plane

- Web/API：Next.js 16 App Router，API route 承载 operator API、Plane webhook、Worker API。
- UI：React 19，优先服务内部操作台，不做营销页。
- DB：PostgreSQL + Prisma migration + `pg` raw SQL；关键写链路必须在事务内完成。
- Contract：Worker API 第一版同时维护 TypeScript 类型与 OpenAPI JSON；Worker 只依赖 contract/client，不依赖 DB package。
- Auth：operator API 与 Worker API 分离；Worker API 使用 `ACP_WORKER_API_TOKEN` 或等价 bearer token。
- State machine：状态转移、lease owner 校验、terminal 幂等、Plane writeback 只在 Control Plane 内执行。
- Observability：run events、progress/workpad、audit events、structured logs 是必需功能；Langfuse 不进入必需链路。
- Rate limit：Plane polling、Plane writeback、Worker claim 都要有最小请求间隔、重试退避和失败记录。

#### Agent Worker

- Runtime：Node 24 + TypeScript + pnpm 11。
- Process：长驻 daemon，可分布式多实例运行；Worker 不连 DB，不持有 Plane API key。
- Control Plane client：通过 HTTPS Worker API 完成 register、claim、heartbeat、events、progress、artifacts、complete、fail。
- Execution adapters：第一版支持 `codex exec --json`；保留 `codex app-server` adapter，用于长会话和 Symphony-style thread。
- Workspace：支持 local path / ephemeral copy / git worktree；默认每个任务独立 worktree，避免并发互相污染。
- Git flow：feature 分支开发，修复后推 PR，由主控合入 main；Worker 不直接在 main 上写代码。
- Logs：本地日志和回传事件必须脱敏 token、password、Bearer、API key、`sk-*`。
- Resilience：heartbeat、lease expiry、retryable fail、workspace cleanup、crash recovery 都是 P0 验收项。

#### Shared Contract / SDK

- 使用共享 TypeScript 类型定义请求/响应 schema；OpenAPI JSON 用于跨仓库校验和后续 SDK 生成。
- 请求必须包含 `workerId`，写命令必须包含 `runId` 与 idempotency key 或单调 sequence。
- Response 必须稳定包含 `ok`/`error` 语义、错误码、可重试标记和必要的当前 run/task 状态。
- Contract tests 要在 Control Plane 和 Worker 两边都跑，避免协议漂移。

#### CI / Quality Gate

- 每个仓库至少具备：`pnpm format`、`pnpm typecheck`、`pnpm test`。
- Control Plane 额外门禁：Prisma validate、DB migration validate、Worker API contract tests、Plane writeback tests。
- Worker 额外门禁：fake Codex adapter smoke、HTTP client contract tests、workspace cleanup tests、lease/heartbeat tests。
- PR 合入规则：feature branch -> PR -> CI pass -> squash merge；禁止直接把 agent 分支强推覆盖 main。

### 分工开发技术边界

后续按模块派 agent 时，以本节作为拆包边界。每个 agent 必须只在自己的 worktree/feature branch 内开发，提交 PR 后由主控合入 main。

#### Plane Agent

- 输入：Plane upstream/fork、self-host runbook、Plane API/webhook capability matrix。
- 技术：Plane upstream stack、Docker Compose、Python/Node 依官方栈、PostgreSQL/Redis 依 Plane 官方部署。
- 任务：fork 同步、固定 upstream commit、repo 一等字段二开、work item 页面 agent 状态入口、Plane API/webhook 回归。
- 禁止：不实现 agent 调度，不访问 Control Plane DB，不持有 Worker token。
- 验收：Plane self-host 可启动，PAT/API/webhook smoke 通过，二开字段或 fallback 行为有文档和测试证据。

#### Control Plane Agent

- 输入：PRD/ERD/Roadmap、Worker API contract、Plane integration 需求。
- 技术：Next.js 16 App Router、React 19、TypeScript、PostgreSQL、Prisma migration、`pg` raw SQL、Vitest。
- 任务：operator UI/API、Worker API server、状态机事务、lease/idempotency/audit、prompt/runtime DB、Plane sync/writeback、cutover scripts。
- 禁止：不启动 Codex 执行任务，不把 Worker 逻辑塞进 Web 进程，不把 Plane DB 当事实源。
- 验收：`pnpm format`、`pnpm typecheck`、`pnpm test`、Prisma validate、Worker API contract tests、Plane writeback tests 通过。

#### Worker Agent

- 输入：Worker API OpenAPI/TypeScript contract、Codex adapter 需求、workspace 策略。
- 技术：Node 24、TypeScript、pnpm 11、Codex CLI、`codex app-server`、git worktree、HTTP client、Vitest。
- 任务：daemon、register/claim/heartbeat/events/progress/artifacts/complete/fail client、Codex adapters、workspace manager、日志脱敏、crash recovery。
- 禁止：不依赖 `@agent-control-plane/db` 作为生产路径，不持有 `DATABASE_URL`、Plane API key 或 operator token，不直接推进 Plane 状态。
- 验收：HTTP client contract tests、fake Codex smoke、workspace cleanup tests、lease/heartbeat/crash recovery tests 通过。

#### Contract / SDK Agent

- 输入：Worker API 路由、Control Plane/Worker 双端需求。
- 技术：TypeScript schema、OpenAPI JSON、contract tests、generated client 或手写轻量 client。
- 任务：维护请求/响应类型、错误码、idempotency header、OpenAPI 输出、跨仓库兼容测试。
- 禁止：不把 DB schema 暴露成跨仓库 SDK，不让 Worker 通过 shared package 获得数据库写能力。
- 验收：Control Plane 和 Worker 两边 contract tests 同时通过；OpenAPI JSON 与 TypeScript 类型不漂移。

#### DevOps / Release Agent

- 输入：三个仓库部署边界、CI gate、production runbook。
- 技术：GitHub Actions、Dockerfile、Docker Compose、pnpm cache、Node 24 toolchain、PostgreSQL backup/restore scripts。
- 任务：CI、镜像构建、tag/release、Compose 部署、rollback、DB backup/restore、env template、final smoke。
- 禁止：不在 CI log 打印 secret，不绕过 PR gate，不把本地绝对路径写成生产默认值。
- 验收：每仓库 release gate 通过，镜像可构建，Compose 可部署，rollback 和 backup/restore 有 dry-run 或 smoke 证据。

### 并行开发规则

- 每个 issue 一个 feature branch，一个独立 git worktree；目录建议为 `../<repo>-<short-topic>`。
- 分支命名：`codex/<module>-<short-topic>`，例如 `codex/worker-http-runner`。
- 开发顺序：先读 `docs/todo.md`、对应 PRD/ERD/Roadmap，再改代码；改设计边界时同步更新 docs。
- 合入顺序：小 PR 并行开发，主控按 CI 通过顺序 squash merge；遇到冲突由主控在 main 最新基线上重放。
- 通信契约优先：涉及 Control Plane <-> Worker 的改动，先改 contract 和测试，再改两端实现。
- 验证最小集：文档-only PR 至少跑 `pnpm format` 和 `git diff --check`；代码 PR 至少跑对应包的 typecheck/test，再按影响面扩大到根级 gate。

### 仓库与进程

| 仓库                               | 进程               | 技术                                                                   | 数据权限                                 | 主要交付                                                                           |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `michaelx1993/plane`               | Plane self-host    | Plane upstream stack、Docker/Compose                                   | Plane 自己的 DB；不访问 Control Plane DB | Plane fork、repo 一等字段、work item UI 二开、自有镜像                             |
| `michaelx1993/agent-control-plane` | Web/API            | Next.js 16、React 19、TypeScript、PostgreSQL、Prisma、pg               | 唯一持有 `DATABASE_URL`                  | Operator UI/API、Worker API、Plane integration、prompt/runtime DB、cutover scripts |
| `michaelx1993/agent-worker`        | Distributed Worker | Node 24、TypeScript、Codex CLI / app-server、git worktree、HTTP client | 不持有 DB；不直接写 Plane                | Worker daemon、Codex adapters、workspace manager、Control Plane HTTP client        |

### 共享契约

- Worker API contract 是 Control Plane 与 Worker 的唯一生产通信边界。
- Contract 第一版可用 OpenAPI JSON 或共享 TypeScript package 生成 client；不得通过 `packages/db` 共享数据库访问。
- Worker 写命令必须带 `runId`、`workerId`、idempotency key 或单调 sequence。
- Control Plane 校验 lease owner、lease expiry、terminal run 幂等和状态机转移。
- Plane writeback 由 Control Plane 统一执行，避免 Worker 分散持有 Plane API key。

### 必要 API

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

### 必要测试与门禁

- 每个仓库必须有 `pnpm format`、`pnpm typecheck`、`pnpm test` 或等价 CI gate。
- `agent-control-plane` 必须覆盖 DB migration validate、Worker API contract tests、Plane webhook/writeback tests、operator API tests。
- `agent-worker` 必须覆盖 Codex CLI fake smoke、Codex app-server fake smoke、HTTP client contract tests、workspace cleanup tests。
- 集成验收必须覆盖真实 Plane task、真实 Worker claim、Codex run events、Progress / Workpad、Plane writeback、task-source audit 和 cutover report。

## P0：仓库拆分与源码所有权

- [x] 创建或整理 `michaelx1993/plane`，作为 Plane self-host 和二开源码仓库。
- [x] 创建 `michaelx1993/agent-control-plane`，作为 Control Plane Web/API 源码仓库。
- [x] 创建 `michaelx1993/agent-worker`，作为分布式 Worker 源码仓库。
- [ ] 为 3 个仓库分别建立 CI、tag、镜像构建和部署脚本。
- [ ] 确认所有生产运行组件都从自有源码仓库构建；不把只能拉官方镜像或不可审计 SaaS 的组件放进必需链路。

P0 当前说明：`michaelx1993/plane`、`michaelx1993/agent-control-plane`、`michaelx1993/agent-worker` 均已创建为 public GitHub 仓库。下一步是把当前孵化仓库的代码按进程边界迁入 `agent-control-plane` / `agent-worker`，并给三个仓库分别补齐 CI、tag、镜像构建、部署和回滚入口。

## P1：Plane Fork 与自部署

- [ ] 同步 `michaelx1993/plane` 与官方 upstream，记录当前基线版本和 commit。
- [ ] 固定 Plane 生产部署版本，形成可复现的自有镜像或 Compose 发布流程。
- [ ] 把 Plane repo 一等字段加入 Plane fork backlog，替代 MVP 阶段的 `repo:<slug>` label fallback。
- [ ] 评估是否在 Plane work item 页面嵌入 agent 状态、run summary、Progress / Workpad 链接。
- [ ] 在自部署 Plane 上复测 PAT/API、webhook、work item、state、comment 和 rate limit 行为。

## P2：Control Plane 仓库

- [ ] 将当前 `apps/web` 迁入 `agent-control-plane`。
- [ ] 将 `packages/core`、`packages/db`、`packages/plane` client 和 migrations 迁入 `agent-control-plane`。
- [ ] 保留 Next.js 16 + React 19 作为 operator UI/API 技术栈。
- [ ] 保留 PostgreSQL + Prisma migration + `pg` raw SQL 查询层，继续用于 lease、dispatch、audit 和 reporting。
- [x] 在 `agent-control-plane` 中新增内部 Worker API server。
- [x] 产出 Worker API OpenAPI/TypeScript contract，供 `agent-worker` 生成或引用 client。
- [ ] 确认 `agent-control-plane` 是唯一持有 `DATABASE_URL` 的应用仓库。
- [ ] 将 Plane webhook、Plane polling sync、Plane writeback、operator UI/API、prompt release、run events、Progress / Workpad、audit、cutover scripts 留在 Control Plane 仓库。
- [x] 增加 Worker API 的 auth、rate limit、lease owner 校验、idempotency 和 audit event。

## P3：Worker 仓库

- [x] 将当前 `apps/worker` 的 Worker daemon、Codex CLI adapter、Codex app-server adapter 和 workspace manager 迁入 `agent-worker`。
- [x] 保留 Node 24 + TypeScript + pnpm 11 + Vitest + Prettier。
- [x] 新增 `HttpControlPlaneClient`，通过 HTTPS Worker API claim、heartbeat、events、progress、complete、fail。
- [x] 移除生产路径中的 `@agent-control-plane/db` 依赖；保留本地 DB worker 只能作为 legacy smoke harness 或测试夹具。
- [x] Worker 只持有 worker token，不持有 Plane API key、`DATABASE_URL` 或 operator token。
- [x] Worker 回传 `nextStateSuggestion` 和执行证据，由 Control Plane 决定最终状态机推进和 Plane writeback。
- [x] Worker workspace 第一版保留 local path / ephemeral / git-worktree 策略。
- [x] Worker 必须支持 `codex exec --json` 和 `codex app-server` 两种 adapter。
- [x] Worker 日志和事件入库前必须本地脱敏 token、password、Bearer、API key 和 `sk-*`。

P3 当前说明：workspace 策略由 `prepareWorkspaceForRun`、`WORKER_WORKSPACE_STRATEGY`、`worker:workspace-smoke` 和 `workspace:cleanup-smoke` 覆盖；Codex 两种 adapter 由 `CodexCliAdapter`、`CodexAppServerAdapter`、`codex:adapter-smoke`、`codex:app-server-smoke` 和 worker adapter 单测覆盖。`michaelx1993/agent-worker` 已推送 standalone HTTP-only Worker 初版，main commit `e3acdb3`，包含 Worker daemon、`HttpControlPlaneClient`、Codex CLI/app-server adapters、workspace cleanup、OpenAPI/TypeScript contract 依赖、Dockerfile、`.env.example` 和 GitHub Actions release gate；本地已通过 `pnpm format`、`pnpm typecheck`、`pnpm test`、`pnpm build`。后续该仓库变更必须通过 PR 合入。

## P4：Worker API Contract

- [x] 定义并实现 `POST /api/worker/v1/register`。
- [x] 定义并实现 `POST /api/worker/v1/runs/claim`。
- [x] 定义并实现 `POST /api/worker/v1/runs/:runId/heartbeat`。
- [x] 定义并实现 `POST /api/worker/v1/runs/:runId/events`。
- [x] 定义并实现 `POST /api/worker/v1/runs/:runId/progress`。
- [x] 定义并实现 `POST /api/worker/v1/runs/:runId/artifacts`。
- [x] 定义并实现 `POST /api/worker/v1/runs/:runId/complete`。
- [x] 定义并实现 `POST /api/worker/v1/runs/:runId/fail`。
- [x] 为 Worker API 输出 OpenAPI JSON 和共享 TypeScript contract。
- [x] 为所有 Worker run 写命令加入 `runId`、`workerId`、lease owner 校验和 idempotency key。
- [x] `complete` / `fail` 必须幂等，重复提交返回已有 terminal result。
- [x] 为 Worker API run 写命令补齐 audit event 和 rate limit。

## P5：真实链路验收

- [ ] 用自部署 Plane 中的真实 task + 真实 repo 跑通默认 `WORKER_EXECUTION_ADAPTER=codex-cli` Development run。
- [ ] 按需用 `WORKER_EXECUTION_ADAPTER=codex-app-server` 复测 Symphony-style thread/turn 长会话。
- [ ] 验证 Control Plane run detail 中存在 Codex run events、prompt release、workspace、Progress / Workpad 和 summary。
- [ ] 发布并验收 Project Meta Git 生产路径，确认真实 Plane-routed run 会写入本地 Meta Git commit，并在 ACP 记录 memory commit evidence。
- [ ] 在真实 Plane project 上复测人工 gate transition、rework 和 feedback comment writeback。
- [ ] 执行 `pnpm task-source:smoke`，证明新任务只从 Plane/Control Plane 派发。
- [ ] 执行真实 secret provider smoke 和 provider audit smoke。
- [ ] 生成真实 cutover report，并让 `pnpm completion:final` 或 `completion:audit` 在 `codex-cli` profile 下通过。

## P6：Cutover

- [ ] 冻结旧 Symphony/Linear poller，或确认其只读。
- [ ] 从 Linear export 未完成任务并导入自部署 Plane。
- [ ] 运行 Plane sync，把 Plane work items 镜像到 Control Plane tasks。
- [ ] 抽查迁移任务具备 Plane URL、repo routing、Control Plane run、Codex events 和 Progress / Workpad。
- [ ] 确认 Linear 只保留归档，不再作为 agent 任务源。
- [ ] 保存 cutover report、external preflight report、Plane writeback evidence、task-source evidence 和 secret provider audit evidence。
