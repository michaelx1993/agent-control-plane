# Agent Control Plane Production Runbook

## 目标

本文记录当前最小生产化发布、部署、回滚、备份和恢复流程。它覆盖 Control Plane 自身，不覆盖 Plane self-host。默认方案不依赖 OpenHands Cloud、Langfuse Cloud 或其它需要额外付费的 SaaS/Enterprise license。

当前状态：

- 已完成：镜像发布、Compose 部署、应用镜像回滚、PostgreSQL 备份、PostgreSQL 恢复、部署前后基础检查、production smoke harness、基础运行监控 dashboard、基础告警、阈值 UI/API 动态配置、generic/slack/email webhook 告警通知、告警失败重放队列、DB-backed operator user、operator signed session 最小登录态、session 管理页、用户创建/更新、细粒度页面/API ACL、secret validate、secret env file/rotation/expiry warning、secret rotation audit log、外部 secret command、secret provider smoke、provider-side audit file/command smoke、Plane writeback smoke harness、cutover gate、12h/24h/7d 趋势图。
- 未完成：真实生产环境外部 smoke、真实供应商账号/API 审计 smoke 和真实 cutover 演练。
- 边界：应用镜像回滚不会回滚数据库 schema 或数据；数据库回滚必须使用部署前备份恢复。
- 快速状态总览：`docs/agent-control-plane-status.md`。

## MBP 当前部署基线

截至 2026-06-25，公网生产入口实际由当前 Mac Studio 承载；历史口径里的 “MBP 部署” 指这套本机 self-host 部署目录和公网 IP。应用层部署目标是只运行我们自己源码经 GitHub hosted CI 构建并推送到 DockerHub 的镜像。社区基础设施镜像允许继续使用，不纳入自研源码镜像范围。

应用层镜像：

| 组件                                       | 镜像                                    | 来源要求                                    |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------- |
| Agent Control Plane Web/API                | `michaelxxx/agent-control-plane:0.0.10` | `michaelx1993/agent-control-plane` 源码构建 |
| Plane frontend                             | `michaelxxx/plane-frontend:0.0.8`       | `michaelx1993/plane` 源码构建               |
| Plane backend / api / worker / beat-worker | `michaelxxx/plane-backend:0.0.8`        | `michaelx1993/plane` 源码构建               |
| Plane admin                                | `michaelxxx/plane-admin:0.0.8`          | `michaelx1993/plane` 源码构建               |
| Plane space                                | `michaelxxx/plane-space:0.0.8`          | `michaelx1993/plane` 源码构建               |
| Plane live                                 | `michaelxxx/plane-live:0.0.8`           | `michaelx1993/plane` 源码构建               |
| Plane proxy                                | `michaelxxx/plane-proxy:0.0.8`          | `michaelx1993/plane` 源码构建               |

允许的社区基础设施镜像：

| 组件                     | 当前镜像                            | 说明                                          |
| ------------------------ | ----------------------------------- | --------------------------------------------- |
| Control Plane PostgreSQL | `postgres:18-alpine`                | 基础设施数据库                                |
| Plane PostgreSQL         | `postgres:15.7-alpine`              | 基础设施数据库                                |
| Plane cache              | `valkey/valkey:7.2.11-alpine`       | Redis-compatible cache，作为 Redis 的开源平替 |
| Plane MQ                 | `rabbitmq:3.13.6-management-alpine` | 基础设施队列                                  |
| Plane object storage     | `minio/minio:latest`                | 基础设施对象存储                              |

部署目录：

```text
/Users/a/agent-control-plane
/Users/a/plane-selfhost/plane-app
```

运行态验收命令：

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | rg 'plane|agent-control-plane'

docker compose \
  --env-file /Users/a/agent-control-plane/.env.mbp-control-plane \
  -f /Users/a/agent-control-plane/docker-compose.yml \
  -f /Users/a/agent-control-plane/docker-compose.override.yml \
  config --images | sort -u

docker compose \
  --env-file /Users/a/plane-selfhost/plane-app/plane.env \
  -f /Users/a/plane-selfhost/plane-app/docker-compose.yaml \
  config --images | sort -u
```

验收口径：

- Plane / Agent Control Plane 应用层不得出现 `makeplane/*`、本地 `build:` 或未命名本地镜像。
- PostgreSQL、Valkey、RabbitMQ、MinIO 可以继续使用社区镜像。
- 公网入口使用公网 IP；Plane CORS 只保留公网访问来源，避免登录后回跳局域网 IP。
- 2026-06-25 最新验收：Plane `http://127.0.0.1:3200/` 与 `http://80.251.222.30:3200/` 返回 200；ACP `http://80.251.222.30:3112/api/readiness` 返回 ready；`pnpm plane:agent-config-sync` 返回 `passed`；Mac Studio worker LaunchAgent running 且最近 stderr 未增长。

本文区分三件事：

- smoke harness：单条链路可执行验证。
- external preflight：真实外部 smoke 前的配置预检，只证明变量和关键开关齐备。
- cutover gate：切换前阻断检查，入口是 `pnpm cutover:check`。
- cutover rehearsal：本地 rehearsal harness 验证 gate 编排；真实完整迁移演练仍必须人工确认旧系统冻结、任务迁移、Plane sync、agent 派发、Codex adapter 执行、Control Plane run events/Progress/Workpad 可追踪、Plane 回写、secret provider 和 provider audit。
- completion audit：读取 cutover JSON report 的最终完成审计，入口是 `pnpm completion:audit`。

## 执行与观测策略

当前生产化默认策略是省钱优先：

- 默认执行器参考 Symphony：Worker 在目标 repo workspace 中启动 `codex app-server` / Codex turn，注入 prompt release 和 task context。
- Codex CLI 是默认执行能力来源，不新增 OpenHands Cloud 费用。
- Control Plane 自己保存 run events、agent progress、workpad、prompt release、conversation-like 事件摘要、token/cost 估算和审计记录。
- Langfuse 不进入默认链路；Cloud 付费版本不考虑，self-host OSS 也只作为未来可选增强，不阻断第一版上线。
- OpenHands 不进入默认链路；Cloud 付费版本不考虑，self-host 也只作为未来可选 `ExecutionAdapter`。
- 所有付费外部服务必须先证明能降低成本、提升交付速度或带来可量化收入，再进入默认架构。

实现状态说明：

- Worker 进程默认 `WORKER_EXECUTION_ADAPTER=codex-cli`，`.env.example` 也按该默认值生成；`mock-openhands` 只用于显式 smoke/legacy contract 测试。
- 当前代码已有 `mock-openhands`、`openhands-cloud`、第一阶段 `codex-cli` adapter 和第一阶段 `codex-app-server` adapter。
- `codex-cli` adapter 已能通过 `codex exec --json` 执行本地 adapter smoke；`worker:codex-smoke` 已用 fake Codex CLI 和显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` 的 fake app-server 验证 Worker/DB/workspace 链路；2026-06-20 已用本机真实 Codex 跑通默认 `codex-cli` 单 turn、显式 `codex-app-server` 单 turn，以及 `codex-app-server` follow-up 两轮同 task thread reuse 的 `worker:codex-real-smoke`，并确认 Codex execution events 会生成任务级 Agent Events Progress；Worker 已可把同一 task 的 previous conversation 注入 adapter，`codex-app-server` adapter 已能复用旧 thread id 启动 follow-up turn；Worker loop 会在进程内复用同一个 execution adapter 实例，`codex-app-server` 默认开启 persistent session，多轮 turn 共用同一个 app-server 进程，可用 `WORKER_CODEX_APP_SERVER_PERSISTENT=false` 退回每 turn 新进程；真实 Plane task 端到端和真实业务长任务事件校准仍是下一步执行层主线。
- `completion:final`、`external:preflight`、`completion:audit` 已支持默认 `codex-cli` profile；OpenHands/Langfuse 只在 legacy external profile 中强制校验。
- 新默认 profile 以 Codex run evidence、Control Plane run events、Progress/Workpad、Plane writeback、production smoke、task-source、secret provider/provider audit、旧 poller 冻结和 Linear 归档作为完成证据。

## 发布镜像

先校验本次统一发布 tag。默认只做 dry-run，不创建 git tag；只有显式设置 `ACP_CREATE_GIT_TAG=true` 才会创建 annotated tag。

```bash
ACP_RELEASE_TAG="agent-control-plane-$(git rev-parse --short=12 HEAD)" \
pnpm release:tag
```

本地或 CI 执行：

```bash
IMAGE_REPOSITORY="ghcr.io/<owner>/agent-control-plane" \
IMAGE_TAG="$ACP_RELEASE_TAG" \
PUSH_IMAGE=true \
pnpm release:image
```

行为：

- 先执行 `pnpm format`、`pnpm check`、`pnpm build`。
- 构建 Docker image。
- 写入 OCI labels：git revision 和 created timestamp。
- `PUSH_IMAGE=true` 时推送 `<repository>:<tag>` 和 `<repository>:latest`。
- CI 或已执行过完整门禁的本地 shell 可设置 `RELEASE_IMAGE_SKIP_VALIDATION=true`，只执行 Docker image build/push 阶段。

## 部署 Compose

```bash
ACP_IMAGE="ghcr.io/<owner>/agent-control-plane:<tag>" \
PLANE_WRITEBACK_ENABLED=true \
PLANE_BASE_URL="https://plane.example.com" \
PLANE_WORKSPACE_SLUG="<workspace>" \
PLANE_PROJECT_ID="<project-id>" \
PLANE_API_KEY="<redacted>" \
WORKER_EXECUTION_ADAPTER=codex-cli \
pnpm deploy:compose
```

行为：

- 启动 PostgreSQL。
- 执行 `scripts/validate-secrets.sh`；`ACP_ENV=production` 或 `SECRET_VALIDATION_STRICT=true` 时会阻断缺失/弱密钥部署。
- 执行 `migrate` 服务：`pnpm db:migrate && pnpm db:seed`。
- 以 `ACP_IMAGE` 启动 Web。
- 默认启动 Worker；可用 `ENABLE_WORKER=false` 禁止。
- 最后请求 `/api/readiness`。
- 设置 `DEPLOY_COMPOSE_DRY_RUN=true` 时只渲染 Compose 配置并输出目标镜像、project 和 worker 开关，不拉镜像、不迁移、不启动服务。

## 回滚应用镜像

```bash
ROLLBACK_IMAGE="ghcr.io/<owner>/agent-control-plane:<previous-tag>" \
pnpm rollback:compose
```

行为：

- 只回滚 Web/Worker 应用镜像。
- 不自动回滚数据库 schema 或数据。
- 回滚后请求 `/api/readiness`。
- 设置 `ROLLBACK_COMPOSE_DRY_RUN=true` 时只渲染 Compose 配置并输出目标 rollback image、project 和 worker 开关，不拉镜像、不重启服务。

数据库回滚必须走备份恢复，不随应用镜像自动回滚：

- 优先恢复部署前备份。
- 如果 migration 已经破坏兼容性，先停止 Worker，避免继续派发任务。
- 恢复后重新运行 `/api/readiness`、`/api/tasks?mode=agent` 和一个只读 run detail 查询。

## 数据库备份

部署前执行：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane" \
BACKUP_DIR="backups" \
pnpm db:backup
```

行为：

- 使用 `pg_dump --format=custom` 生成可被 `pg_restore` 恢复的备份。
- 默认备份到 `backups/agent-control-plane-<utc timestamp>.dump`。
- 生成 `.sha256` 校验文件。

## 数据库恢复

恢复是破坏性动作，必须显式确认：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane" \
BACKUP_PATH="backups/agent-control-plane-20260619T120000Z.dump" \
CONFIRM_RESTORE="restore-agent-control-plane" \
pnpm db:restore
```

行为：

- 如存在 `.sha256` 文件，先校验备份。
- 默认先停止 worker，避免恢复期间继续派发任务；可用 `STOP_WORKER=false` 覆盖。
- 使用 `pg_restore --clean --if-exists` 恢复数据库。
- 默认恢复后请求 `/api/readiness`；可用 `RUN_READINESS_CHECK=false` 覆盖。

## 部署前检查

```bash
pnpm format
git diff --check
pnpm check
pnpm build
pnpm secrets:validate
pnpm secrets:env-smoke
pnpm db:validate
pnpm plane:live-smoke
pnpm db:backup
```

本地完成门禁聚合：

```bash
pnpm completion:local-smoke
```

该命令会执行 `git diff --check`、脚本语法检查、`doc-script-parity-smoke`、`pnpm check`、`pnpm db:validate`、`pnpm secrets:validate`、Core/DB/Plane build、`operator:query-smoke`、`linear:migrate-smoke`、`plane:human-gate-writeback-smoke`、`worker:contract-smoke`、`worker:codex-plane-smoke` 默认安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server pnpm worker:codex-plane-smoke` 安全 skip、`WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm worker:codex-plane-smoke` 安全 skip、`worker:codex-plane-report-smoke`、`openhands:payload-contract`、`task-source:local-smoke`、`cutover:report-smoke`、`external:preflight-smoke`、`completion:doctor-smoke`、`completion:gap-smoke`、`completion:final-env-template-smoke`、`completion:audit-smoke`、`completion:final-smoke`、`completion:local-web-build-smoke`。`operator:query-smoke` 会在临时 PostgreSQL 数据库上执行真实 operator task/run 查询，覆盖 enum/text 兼容问题。`worker:contract-smoke` 会验证 Control Plane Worker API OpenAPI 文档、run write route handlers 和 idempotency 参数一致。`codex:app-server-smoke` 会用 fake app-server 验证 Codex app-server JSON-RPC 生命周期和事件落库前摘要转换。`worker:codex-plane-smoke` 在本地聚合门禁中只验证未显式 apply 时的安全跳过、app-server adapter 选择和 Plane follow-up 开关入口，不替代真实 Plane 写入 smoke；`worker:codex-plane-report-smoke` 会离线验证 JSON evidence report 的字段、`0600` 权限和默认拒绝覆盖。`cutover:codex-rehearsal` 使用本地 mock Plane 和默认 `codex-cli` profile 验证 Codex-first cutover gate，并确认 mock report 被 audit 拒绝；`cutover:rehearsal` 显式使用 `legacy-openhands` profile，只覆盖可选 legacy contract 并验证 completion audit 会拒绝 rehearsal report，不代表默认 Codex-first 完成证据。`doc-script-parity-smoke` 会静态检查 package 中 completion/cutover/smoke 入口在文档中可见，并检查 local completion smoke 的内部步骤仍出现在 runbook/status 清单中。默认 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=auto`：未检测到 `apps/web/.next/dev/lock` 时会自动执行 Web production build；若本地 `pnpm dev` 持有 lock，则跳过并输出持锁 PID。设置 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=true` 会强制执行 Web build，dev lock 存在时阻断；设置为 `false` 会始终跳过。Web production build 遇到瞬时 Next 并发 build lock 时默认重试 1 次，可用 `ACP_LOCAL_COMPLETION_WEB_BUILD_RETRIES` 和 `ACP_LOCAL_COMPLETION_WEB_BUILD_RETRY_DELAY_SECONDS` 调整；非 lock 构建失败不重试；`completion:local-web-build-smoke` 会单独验证 retry / 非 lock 不重试 / 非法参数拒绝。它仍是本地 harness，不替代真实外部 cutover。

最近一次记录：2026-06-20 00:00 PDT 已通过 `ACP_LOCAL_COMPLETION_RUN_WEB_BUILD=false pnpm completion:local-smoke`，最终输出 `local_completion_smoke=passed`、`cutover_codex_rehearsal=passed`、`cutover_rehearsal=passed`；Web production build 按显式环境变量跳过。该记录可作为本地开发门禁证据；生产切换仍必须继续执行 `external:preflight`、`completion:final`，并保留真实 `ACP_CUTOVER_REPORT_FILE`。

真实外部 smoke 前先跑配置预检：

```bash
ACP_SECRET_ENV_FILE=".secrets/completion-final.env" pnpm external:preflight
```

需要把当前缺口归档时使用：

```bash
ACP_SECRET_ENV_FILE=".secrets/completion-final.env" \
ACP_COMPLETION_GAP_REPORT_FILE="reports/completion-gap-$(date -u +%Y%m%dT%H%M%SZ).json" \
pnpm completion:gap
pnpm completion:doctor
```

`external:preflight` 已支持默认 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli`，会检查 production smoke、Plane writeback、Codex adapter evidence、task-source、secret provider、provider audit、旧 poller 冻结和 Linear 归档；显式选择 legacy external profile 时才检查 OpenHands/Langfuse 相关配置。脚本保留的安全能力仍有效：先加载 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND`，只输出变量状态不打印 secret，拒绝 shell command substitution、模板占位符和不安全 URL，并能输出权限为 `0600` 的预检 JSON 报告。报告中的模板下一步命令会跟随目标 env 文件状态：文件已存在时自动输出 append-missing 命令。

`completion:gap` 是 `external:preflight` 的归档包装器：它会强制 allow-missing，默认把报告写到 `reports/completion-gap-<timestamp>.json`；若未显式设置 `ACP_SECRET_ENV_FILE` 且默认 `.secrets/completion-final.env` 存在，它会自动加载该文件用于诊断缺口，避免 operator 忘记带 env 后看到全量空缺；可用 `ACP_COMPLETION_GAP_USE_DEFAULT_ENV_FILE=false` 关闭，或用 `ACP_COMPLETION_GAP_DEFAULT_ENV_FILE` 改默认路径。它会输出当前 `ACP_SECRET_ENV_FILE` 状态、默认 `.secrets/completion-final.env` 是否存在、`default_final_env_file_hint`、ready/missing 计数、占位符/缺变量/不安全 URL 计数、缺口变量名清单、`completion_final_auto_bound_missing_variables`、`manual_missing_variables`、manual 变量按 `missing_required` / `placeholder` / `not_true` / `unsafe_url` / `other` 拆分的清单、每个验收 scope 的 `scope=<name>;status=<status>;ready=<n>;missing=<n>` 摘要，以及生成 `.secrets/completion-final.env` 或对既有 env 执行 append-missing、带 `ACP_SECRET_ENV_FILE` 执行 `external:preflight`、复跑 `completion:gap` 和执行 `pnpm completion:final` 的下一步命令；若当前已显式设置 `ACP_SECRET_ENV_FILE`，终端、JSON report 和 action plan 中的 external preflight/复跑/最终命令会沿用该路径；JSON report 会保留 `external:preflight` 原有分项 smoke nextCommands，并只规范其中的 external preflight/gap/final env 路径。默认还会写出权限为 `0600` 的 `reports/<gap-id>.variables.txt`、`reports/<gap-id>.variables.tsv`、`reports/<gap-id>.checklist.md` 和 `reports/<gap-id>.action-plan.md`，并在终端输出 JSON report、variables、matrix、checklist 和 action plan 的 `600` mode；JSON report 的 `generatedArtifacts` 也会写入 artifact 路径、缺口变量列表、auto-bound/manual 变量计数和 manual reason 分组，TSV 字段为 `variable / scopes / reason_types / missing_count`，Markdown checklist 按 scope 生成可勾选缺口项，并单列 `completion:final` 会自动绑定的 final run id、external preflight id、cutover report id、cutover report path，以及 final wrapper 会强制默认的 Codex-first 最终 smoke / adapter / writeback 开关，并把 OpenHands/Langfuse 仅作为 legacy optional 开关列出；manual 变量 reason 分组只保留操作者必须真实填写的变量；action plan 按 operator sequence、auto-bound 变量、manual 变量和 scope 优先级组织下一步执行顺序，可用 `ACP_COMPLETION_GAP_VARIABLES_FILE` / `ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE` / `ACP_COMPLETION_GAP_CHECKLIST_FILE` / `ACP_COMPLETION_GAP_ACTION_PLAN_FILE` 改路径。它不会执行真实 smoke，也不会把缺口报告当作完成证据。

`completion:doctor` 会调用同一套 gap 逻辑，并额外输出本机只读探针：final env 文件是否存在和权限、关键 URL 变量是缺失/占位/已设置、默认本机 Plane `127.0.0.1:3200` 和 Control Plane readiness 是否可达，以及 OpenHands/Langfuse probe 状态。它还会输出 `gap_scope_summary` 和每个 `gap_scope_<scope>_status/ready/missing`，便于一眼看出当前卡在 `cutover_gate`、`plane_writeback`、`task_source` 还是其它 scope；并输出 `manual_placeholder_variables`、`manual_not_true_variables`、`hint_fill_manual_variables`、`hint_replace_placeholders`、`hint_confirm_cutover_booleans`、`hint_start_control_plane`、`hint_start_control_plane_command`、`next_command_generate_env_template`、`gap_variable_matrix_file`、`next_command_view_action_plan`、`next_command_view_checklist`、`next_command_view_variable_matrix` 和 `next_command_show_missing`；当 final env 文件已存在时，该模板命令会自动带 `ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true`，避免 operator 直接重跑模板命令被“文件已存在”挡住。为避免 operator 看到变量“有值”却仍被 preflight 判为占位符，doctor 会对 Plane、operator、secret provider、writeback work item、legacy poller evidence 和 Linear archive evidence 等关键 manual 变量逐项输出 `env_<NAME>=missing|placeholder|set`；OpenHands/Langfuse 在默认 `codex-cli` profile 下输出 `optional_missing|optional_placeholder|optional_set`，只有 `ACP_COMPLETION_EXECUTION_PROFILE=legacy-openhands|openhands-cloud|openhands-langfuse|external` 时才按必填状态输出；对 `ACP_CUTOVER_LEGACY_POLLER_READONLY` 和 `ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED` 会输出 `missing|placeholder|false|true`，只有 `true` 才算 cutover gate 已确认。它只输出状态和变量名，不输出 secret 值；适合在正式 `external:preflight` 前快速判断是 env 没填、本机服务没起、人工 gate 未确认，还是可以进入真实 smoke。

准备最终 cutover dotenv 模板时使用：

补充：`completion:final` 会把本次 `ACP_EXTERNAL_PREFLIGHT_ID` 传入最终审计；只要该变量存在，`completion:audit` 就会要求 cutover report 中 external preflight evidence 的 `preflight_id` 与其一致，避免把其它 run 的预检结果混入当前完成声明。

补充：最终审计不只看 evidence 里“有日期”。默认 `codex-cli` profile 会检查 Codex Worker run、Control Plane run events、Progress / Workpad、Plane writeback、task-source、secret provider 和 provider audit；legacy external profile 下的 OpenHands conversation evidence 必须同时包含非 mock `ui_url`、`conversation_id` 和实际存在、权限为 `0600` 或 `0400` 的 `payload_file`，且 `completion:audit` 会用该文件执行 `OPENHANDS_PAYLOAD_CONTRACT_FILE=<payload_file> pnpm --silent openhands:payload-contract`；provider audit 的 `newest_event_at`、旧 poller 冻结证据日期和 Linear 归档证据日期都必须落在 `ACP_COMPLETION_AUDIT_MAX_REPORT_AGE_HOURS` 窗口内，默认 24 小时；fresh report 不能夹带陈旧供应商审计或旧系统切换证据。

```bash
ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=".secrets/completion-final.env" \
pnpm completion:final-env-template
```

`completion:final-env-template` 当前默认生成 Codex-first 模板，预填 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli`、`WORKER_EXECUTION_ADAPTER=codex-cli`、Plane writeback、task-source、worker crash/budget/workflow、secret provider、provider audit、旧 poller 冻结和 Linear 归档相关变量。`ACP_CUTOVER_LEGACY_POLLER_READONLY` 和 `ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED` 会以 `false` 写入模板，operator 必须在取得对应证据后显式改为 `true`，否则 `completion:doctor` 和 `external:preflight` 都会继续阻断。显式把 `WORKER_EXECUTION_ADAPTER` 改为 `codex-app-server` 时，最终门禁会使用 Symphony-style app-server adapter smoke。OpenHands/Langfuse 只以注释形式保留给 legacy external profile。模板仍保持权限 `0600`、拒绝覆盖、拒绝 shell command substitution 和占位符。

如果 `.secrets/completion-final.env` 已经存在，只想补齐新模板变量而不覆盖已有真实值，使用：

```bash
ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=".secrets/completion-final.env" \
ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true \
pnpm completion:final-env-template
```

该模式只追加当前文件缺失的 active assignment，保留已有变量值，并把文件权限修正为 `0600`。

预检脚本自检：

```bash
pnpm external:preflight-smoke
pnpm cutover:report-smoke
```

这些 smoke 会验证缺配置必须失败、allow-missing 只能用于输出缺口清单、完整模拟配置可以通过，并检查输出里不会泄露 fixture secret；`cutover:report-smoke` 还会验证 `cutover:check` 失败时也会写出 `0600` JSON report，且 report 中包含 failed readiness、`reportId`、errors 和 `completionFinalRunId`。需要把 report 绑定到外部变更单、final run 或 cutover issue 时，可显式设置 `ACP_CUTOVER_REPORT_ID`；留空时由 `cutover:check` 生成非敏感 report id。

最终 cutover 的推荐执行链：

```bash
ACP_SECRET_ENV_FILE=".secrets/completion-final.env" \
pnpm external:preflight

ACP_SECRET_ENV_FILE=".secrets/completion-final.env" \
ACP_COMPLETION_FINAL_RUN_ID="manual-$(date -u +%Y%m%dT%H%M%SZ)" \
ACP_CUTOVER_REPORT_FILE="reports/cutover-$(date -u +%Y%m%dT%H%M%SZ).json" \
ACP_CUTOVER_RUN_PRODUCTION_SMOKE=true \
ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE=true \
ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE=true \
ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE=true \
ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE=true \
ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE=true \
ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE=true \
ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE=true \
ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT=true \
WORKER_EXECUTION_ADAPTER=codex-cli \
pnpm cutover:check

ACP_COMPLETION_FINAL_RUN_ID="<上一步使用的 final run id>" \
ACP_COMPLETION_AUDIT_REPORT_FILE="<上一步输出的 report path>" \
pnpm completion:audit
```

等价的一键最终门禁：

```bash
ACP_SECRET_ENV_FILE=".secrets/completion-final.env" \
ACP_CUTOVER_REPORT_FILE="reports/cutover-$(date -u +%Y%m%dT%H%M%SZ).json" \
pnpm completion:final
```

`completion:final` 当前默认 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli`，会生成 final run id、external preflight id 和 cutover report id，并按 `external:preflight -> cutover:check -> completion:audit` 顺序执行；dry-run 和执行前提示会输出生成最终 env 模板或 append-missing 的下一步命令；evidence 集合以 Codex adapter / Codex Worker run、Control Plane run events、Progress/Workpad、Plane writeback、production smoke、task-source、secret provider、provider audit、旧 poller 冻结和 Linear 归档为主。OpenHands/Langfuse 只在显式选择 legacy external profile 时强制。

`.env.example` 已列出最终门禁相关变量，包括 `ACP_EXTERNAL_PREFLIGHT_ID`、`ACP_EXTERNAL_PREFLIGHT_REPORT_FILE`、`ACP_CUTOVER_REPORT_ID`、`ACP_CUTOVER_REPORT_FILE` 和 `ACP_COMPLETION_FINAL_RUN_ID`。正式执行 `completion:final` 时推荐让 `ACP_COMPLETION_FINAL_RUN_ID`、`ACP_EXTERNAL_PREFLIGHT_ID` 和 `ACP_CUTOVER_REPORT_ID` 留空自动生成；只有分步执行 `external:preflight -> cutover:check -> completion:audit` 或需要绑定外部变更单时，才手工固定同一组 id。

在分步执行 `external:preflight -> cutover:check -> completion:audit` 时，如果手工固定了 `ACP_EXTERNAL_PREFLIGHT_ID`，审计环境也必须带同一个值；否则只能证明 report 有任意一次通过的预检，不能证明它属于当前 cutover。

判定规则：

- `external:preflight` 失败时不要进入真实 smoke；先补变量、权限或目标资源。
- `cutover:check` 必须写出 `ACP_CUTOVER_REPORT_FILE`，成功或失败都要保留报告。
- `cutover:check` 默认拒绝覆盖已存在的 `ACP_CUTOVER_REPORT_FILE`；该路径即使来自 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND` 也会在 secret 加载后检查。只有受控复跑且确认要替换旧报告时，才显式设置 `ACP_CUTOVER_REPORT_OVERWRITE=true`。
- `completion:final` 是推荐最终入口；分步执行时，`completion:audit` 必须基于真实 report 通过，不得设置 `ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE=true` 或其它 allow/skip 调试开关。
- 本地 `pnpm cutover:rehearsal` 只能证明脚本编排有效，不能作为最终完成证据。

需要确认：

- `ACP_OPERATOR_API_TOKEN` 在非本机环境必须配置；最终 cutover 严格模式还要求 `ACP_OPERATOR_LOGIN_PASSWORD` 和 `ACP_OPERATOR_SESSION_SECRET` 同时存在，用于浏览器 operator 登录和 signed session。
- `ACP_ENV=production` 或 `SECRET_VALIDATION_STRICT=true` 时，`pnpm secrets:validate` 会检查 `DATABASE_URL`、`ACP_OPERATOR_API_TOKEN`、`ACP_OPERATOR_LOGIN_PASSWORD`、`ACP_OPERATOR_SESSION_SECRET`、`PLANE_WEBHOOK_SECRET`、Plane writeback、Codex-first cutover 所需变量和 monitoring alert format；OpenHands/Langfuse 只在启用对应 optional/legacy profile 时要求配置。
- `MONITORING_ALERT_WEBHOOK_URL` 可选；配置后 worker 会把 warning/critical 告警 POST 到该 webhook。
- `MONITORING_ALERT_MIN_INTERVAL_MS` 控制相同告警指纹的最小重复发送间隔，默认 15 分钟。
- `MONITORING_ALERT_FORMAT` 支持 `generic` / `slack` / `email`，默认 `generic`。Slack incoming webhook 应设置为 `slack`，邮件 provider webhook 可设置为 `email`。
- `MONITORING_ALERT_REPLAY_LIMIT` 控制每轮最多重放多少条失败告警，默认 10。
- `MONITORING_ALERT_RETRY_BACKOFF_MS` 控制失败告警下次尝试时间，默认 5 分钟。
- `PLANE_WRITEBACK_ENABLED=true` 时，Plane 环境变量必须完整。
- 使用 `openhands-cloud` adapter 时，`OPENHANDS_API_KEY` 必须存在。
- `LANGFUSE_ENABLED=true` 时，Langfuse public/secret key 必须存在。
- `WORKER_REPOSITORY_CONCURRENCY_LIMIT` 可选限制同一 repo active runs 数量，避免多个 agent 同时改同一仓库。
- `WORKER_ROLE_CONCURRENCY_LIMIT` 可选限制同一 role active runs 数量，避免单角色 agent 池被抢爆。
- `WORKER_AGENT_CONCURRENCY_LIMIT` 可选限制同一 agent definition active runs 数量；多个 active agent definitions 存在时，claim 会优先选择当前 active run 更少的 agent。
- `WORKER_WORKSPACE_STRATEGY=auto` 默认优先使用 repository `local_path`，否则创建 ephemeral workspace；`git-worktree` 会在 repository `local_path` 存在时为每个 run 创建隔离 worktree，降低同 repo 并发修改冲突。
- `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` 可作为单 run 估算成本门禁的环境变量 fallback；`/settings` Dispatch Policy 或 `PUT /api/dispatch/policy` 写入 `app_settings(dispatch.max_estimated_cost_usd_per_run)` 后优先于 env 生效。
- `WORKER_QUEUE_PRIORITY_POLICY` 可作为队列排序 fallback，支持 `priority_first`、`priority_aging`、`repo_fair`、`weighted_priority`、`oldest_first`、`newest_first`；`/settings` 派发策略或 `PUT /api/dispatch/policy` 写入 `app_settings(dispatch.queue_priority_policy)` 后优先于 env 生效。
- 超过预算的任务不会派发给 agent；worker 会把它置为 `Blocked`，并在任务级 Progress / Workpad 写入预算超限原因。需要抢先处理的任务应在 Plane 同步路径中保留较小 priority。`priority_aging` 会按 `coalesce(priority, 1000000) - floor(wait_hours / 24)` 排序，让等待每满 24 小时的任务提升 1 档有效优先级；`repo_fair` 会按 repo 内 priority/updated_at 排队，再跨 repo 轮转，避免单个 repo 长队列吞掉派发窗口；`weighted_priority` 会按 `coalesce(priority, 1000000) + coalesce(estimated_cost_usd, 0)` 排序，让同等优先级下低成本任务更早进入执行。

## 部署后检查

```bash
curl -fsS "http://127.0.0.1:3112/api/readiness"
curl -fsS -H "authorization: Bearer <operator-token>" "http://127.0.0.1:3112/api/runs?limit=5"
curl -fsS -H "authorization: Bearer <operator-token>" "http://127.0.0.1:3112/api/runs?status=running&repository=crs-src&role=development&limit=5"
curl -fsS -H "authorization: Bearer <operator-token>" "http://127.0.0.1:3112/api/tasks?mode=agent&limit=5"
```

也可以执行 production smoke harness：

```bash
ACP_SMOKE_BASE_URL="http://127.0.0.1:3112" \
ACP_SECRET_ENV_FILE=".secrets/agent-control-plane.env" \
pnpm smoke:production
```

默认 smoke 只执行只读检查：加载 `ACP_SECRET_ENV_FILE` / `ACP_SECRET_COMMAND`、secret validate、readiness、auth session、runs、tasks、audit events、users。readiness 不只检查 HTTP 200，还会要求返回 `service=agent-control-plane-web` 且 `database.connected=true`；只有临时 HTTP/router 诊断时才设置 `ACP_SMOKE_REQUIRE_READINESS_DATABASE=false`。
若需要验证用户写入口，显式设置：

```bash
ACP_SMOKE_ENABLE_USER_WRITE=true pnpm smoke:production
```

若需要验证外部依赖只读可达性，显式设置：

```bash
ACP_SMOKE_EXTERNAL=true pnpm smoke:production
```

外部依赖探针：

- Plane：请求 `/api/v1/workspaces/<workspace>/projects/<project>/states/`，验证 `PLANE_BASE_URL`、`PLANE_WORKSPACE_SLUG`、`PLANE_PROJECT_ID` 和 `PLANE_API_KEY` 可用。
- OpenHands：默认请求 `OPENHANDS_BASE_URL + /api/v1/app-conversations?ids=__acp_smoke_probe__`，使用 `OPENHANDS_API_KEY` Bearer auth；如 API 版本不同，可用 `ACP_SMOKE_OPENHANDS_PROBE_PATH` 覆盖。
- Langfuse：默认请求 `LANGFUSE_BASE_URL + /api/public/health`；如部署版本不同，可用 `ACP_SMOKE_LANGFUSE_PROBE_PATH` 覆盖。存在 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 时会带 Basic auth。
- 期望状态码默认都是 `200`，可分别用 `ACP_SMOKE_PLANE_EXPECTED_STATUS`、`ACP_SMOKE_OPENHANDS_EXPECTED_STATUS`、`ACP_SMOKE_LANGFUSE_EXPECTED_STATUS` 覆盖。

仍需要人工或端到端任务确认：

- Worker 没有重复 claim 同一个 task。
- Plane writeback comment 正常出现。
- Codex run events、Progress / Workpad 和 Run Detail 可追踪。
- OpenHands conversation URL / Langfuse trace URL 只在启用 optional/legacy profile 时抽查。

边界：

- `pnpm smoke:production` 默认验证的是 Control Plane 自身 API、认证链路和 readiness 数据库连接；`ACP_SMOKE_EXTERNAL=true` 只证明外部只读探针可达，不等于真实 Codex agent run、真实 Plane writeback、真实 task-source 证据或 optional Langfuse trace 已完成。
- `pnpm worker:codex-real-smoke` 会调用本机真实 Codex，必须显式设置 `WORKER_CODEX_REAL_SMOKE_CONFIRM=true` 才执行；默认使用 `WORKER_CODEX_MODEL=gpt-5.5` 和 `WORKER_CODEX_REASONING_EFFORT=high`，在临时 DB / git-worktree workspace 中要求 Codex 创建 marker 文件。该 smoke 已用默认 `codex-cli`、显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` 单 turn，以及 `WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_SMOKE_FOLLOW_UP=true` 两轮 follow-up 跑通，可用于生成真实 Codex Worker run evidence，但不能替代真实 Plane task / Plane writeback / task-source cutover 样本。
- `pnpm worker:codex-plane-smoke` 在未设置 `WORKER_CODEX_PLANE_SMOKE_APPLY=true` 时只做安全 skip，用于本地聚合门禁。拆仓后真实 apply 模式会委托 `agent-worker` 仓库执行一次 HTTP Worker run：需要已有 Control Plane Web/API 服务、`CONTROL_PLANE_BASE_URL`、`ACP_WORKER_API_TOKEN`、可派发的 Plane-routed task，以及 `AGENT_WORKER_REPO_PATH`（默认同级 `../agent-worker`）。设置 `WORKER_CODEX_PLANE_SMOKE_TEMP_DB=false` 后，脚本会用 `codex-cli` 或显式 `WORKER_EXECUTION_ADAPTER=codex-app-server` claim/run/complete，并在提供 `DATABASE_URL` 时回查任务 URL、`codex.*` run events、Running / Agent Events / Completed Progress，输出 `run_id`、`task_identifier`、`repository_slug`、`role` 和 evidence 计数。设置 `WORKER_CODEX_PLANE_SMOKE_REPORT_FILE=reports/worker-codex-plane-<id>.json` 时，成功路径会写出权限为 `0600` 的机器可读 evidence report，包含非 secret 的 worker/run/task/repo、DB evidence 计数、workspace、adapter、model 和 follow-up 要求；已有 report 默认拒绝覆盖，只有 `WORKER_CODEX_PLANE_SMOKE_REPORT_OVERWRITE=true` 才允许复写；本地 `pnpm worker:codex-plane-report-smoke` 会验证 report writer 的字段、权限和覆盖保护。app-server 路径会透传 `WORKER_CODEX_APP_SERVER_COMMAND` / `WORKER_CODEX_APP_SERVER_ARGS_JSON`；设置 `WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true` 时，脚本不会模拟打回，而是要求已有可派发 run 产生 `codex.thread_reused` event 和 `codex-app-server` conversation ref，证明真实 Control Plane follow-up 上下文已经被 Worker 复用。`PLANE_BASE_URL` / `PLANE_WORKSPACE_SLUG` / `PLANE_PROJECT_ID` / `PLANE_API_KEY` 只在 `WORKER_CODEX_PLANE_SMOKE_REQUIRE_PLANE_ENV=true` 时强制，因为 split mode 不直接调用 Plane API，而是验证 Control Plane 中已有的 Plane-routed task。该脚本不再在 Control Plane 仓库内直接创建临时 worker，因为 Worker 已拆到 `michaelx1993/agent-worker`。
- `ACP_SMOKE_SKIP_SECRET_VALIDATE=true` 只应用于临时诊断；生产验收不得跳过 secret validate。
- 用户写入口 smoke 会真实创建或更新 operator user，只能在明确允许写入的环境开启。

OpenHands conversation smoke：

```bash
OPENHANDS_BASE_URL="https://app.all-hands.dev" \
OPENHANDS_API_KEY="<redacted>" \
pnpm openhands:smoke
```

默认只执行只读 probe。真实 conversation smoke 必须显式开启：

```bash
OPENHANDS_BASE_URL="https://app.all-hands.dev" \
OPENHANDS_API_KEY="<redacted>" \
OPENHANDS_SMOKE_CREATE_CONVERSATION=true \
OPENHANDS_SMOKE_SELECTED_REPOSITORY="owner/repo" \
pnpm openhands:smoke
```

行为：

- 默认 probe 路径是 `/api/v1/app-conversations?ids=__acp_smoke_probe__`，可用 `OPENHANDS_SMOKE_PROBE_PATH` 覆盖。
- `OPENHANDS_SMOKE_CREATE_CONVERSATION=true` 时会 POST `/api/v1/app-conversations`，要求返回 `app_conversation_id` 或 READY 状态下的 `id`。
- 如果需要等待 start task ready，可设置 `OPENHANDS_SMOKE_WAIT_READY=true`，并用 `OPENHANDS_SMOKE_POLL_ATTEMPTS` / `OPENHANDS_SMOKE_POLL_INTERVAL_SECONDS` 控制轮询。

OpenHands adapter smoke：

```bash
OPENHANDS_BASE_URL="https://app.all-hands.dev" \
OPENHANDS_API_KEY="<redacted>" \
OPENHANDS_SELECTED_REPOSITORY="owner/repo" \
pnpm openhands:adapter-smoke
```

行为：

- 直接调用 worker 的 `OpenHandsCloudAdapter.execute()`，覆盖 create conversation、start task ready、execution terminal polling、conversation ref、event summary 和 role 默认 next state。
- 默认 role 是 `development`，成功后应输出 `next_state=Code Review`。
- 可用 `OPENHANDS_ADAPTER_SMOKE_*` 覆盖 repository、prompt、role 和轮询超时。

OpenHands payload contract：

```bash
pnpm openhands:payload-contract
OPENHANDS_PAYLOAD_CONTRACT_FILE="/secure/raw-openhands-payload.json" pnpm openhands:payload-contract
OPENHANDS_SMOKE_CREATE_CONVERSATION=true \
  OPENHANDS_SMOKE_WAIT_READY=true \
  OPENHANDS_SMOKE_PAYLOAD_FILE="/secure/raw-openhands-payload.json" \
  pnpm openhands:smoke
OPENHANDS_PAYLOAD_CONTRACT_FILE="/secure/raw-openhands-payload.json" pnpm openhands:payload-contract
```

行为：

- 默认读取 `apps/worker/fixtures/openhands-payload-contract.sample.json`，不调用 OpenHands API。
- `OPENHANDS_SMOKE_PAYLOAD_FILE` 会让 `pnpm openhands:smoke` 在创建真实 conversation 后回读 conversation 和同源 event log，把 payload contract JSON 写到权限为 `0600` 的文件；该文件可能包含原始 OpenHands 事件，只能放在受控路径，不应提交。
- 传入真实 payload 文件后，`pnpm openhands:payload-contract` 会校验 terminal decision、event summary 类型、trace ref 提取和 secret 脱敏，适合在真实 API payload 结构变化后做 adapter 校准。
- 该 contract 只证明 payload parser 能处理样本，不替代 `pnpm openhands:smoke`、`pnpm openhands:adapter-smoke` 或数据库驱动 run smoke。
- event summary 会对 LLM generation 中的字符串或嵌套 chat messages / choices 做脱敏摘要，保留 prompt/input/output、model、token、cost、latency 和 trace 字段；真实 smoke 后应抽查 run detail 是否出现 `openhands.llm_generation`，没有该事件不代表失败，但说明真实 OpenHands payload 没暴露逐 call 内容。
- 若真实 OpenHands conversation payload 不返回 `event_log_url` / `events_url`，可设置 `OPENHANDS_SMOKE_EVENT_LOG_PATH_TEMPLATE` 或 `OPENHANDS_EVENT_LOG_PATH_TEMPLATE` 作为同源 event API fallback，例如 `/api/v1/app-conversations/{conversationId}/events`。模板支持 `{conversationId}` 和 `:conversationId`。
- 支持 `ACP_SECRET_ENV_FILE` 和 `ACP_SECRET_COMMAND` 注入 secret。
- 这是 adapter 级 smoke，不写数据库；真实端到端 Development run 仍需由 worker 从 Plane task 派发后验证。

OpenHands database run smoke：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane" \
OPENHANDS_BASE_URL="https://app.all-hands.dev" \
OPENHANDS_API_KEY="<redacted>" \
OPENHANDS_SELECTED_REPOSITORY="owner/repo" \
pnpm openhands:db-smoke
```

行为：

- upsert 一条 `Development` smoke task，默认 project 为 `token`、repo 为 `crs-src`，可用 `OPENHANDS_DB_SMOKE_*` 覆盖。
- 执行一次 worker，默认使用 `openhands-cloud` adapter 和 `priority_first` queue policy。
- 成功时输出 `run_id`、`conversation_id`、OpenHands `ui_url`、`prompt_release_id`、`trace_refs`、首个 `trace_ui_url`、`next_state` 和 `events`，其中 URL 字段应归档到 cutover issue 或变更单。
- 回查 run detail，确认 run succeeded、next state 为 `Code Review`、prompt release 已绑定、`conversation_refs(provider=openhands-cloud)` 已写入，并存在 `workspace.ready` / `openhands.status` events。
- 推荐使用专用 smoke project。仅在临时库或专用测试项目中设置 `OPENHANDS_DB_SMOKE_ISOLATE_PROJECT=true`；该开关会把同项目其它 `Todo` / `Development` / `Code Review` / `Release Version` / `Deployment` 任务退回 `Backlog`，确保本轮 worker 只执行 smoke task。
- 支持 `ACP_SECRET_ENV_FILE` 和 `ACP_SECRET_COMMAND` 注入 secret。

Worker lease renewal smoke：

```bash
pnpm worker:lease-smoke
```

行为：

- 默认创建临时 PostgreSQL 数据库，执行 migration 和 seed。
- upsert 一条 `Development` smoke task。
- 使用延迟 `mock-openhands` 模拟长任务。
- 要求 run succeeded、next state 为 `Code Review`，并至少写入两个 `heartbeat` events。
- 结束后删除临时数据库。
- 设置 `WORKER_LEASE_SMOKE_TEMP_DB=false` 后才会复用当前 `DATABASE_URL`。
- 该 smoke 只证明本地 worker lease renewal 机制有效，不替代真实 Codex 长任务验收。

Worker crash recovery smoke：

```bash
pnpm worker:crash-smoke
```

行为：

- 默认创建临时 PostgreSQL 数据库，执行 migration 和 seed。
- upsert 一条 `Development` smoke task。
- 插入一条 heartbeat 和 lease 都已过期的 `running` run，模拟 worker 崩溃遗留占用。
- 要求旧 run 被标记为 `stalled`，同一任务以 `attempt=2` 被重新认领，并推进到 `Code Review`。
- 结束后删除临时数据库。
- 设置 `WORKER_CRASH_SMOKE_TEMP_DB=false` 后才会复用当前 `DATABASE_URL`。
- 该 smoke 只证明本地 lease 过期恢复机制有效，不替代真实 Codex 进程崩溃、真实 workspace 残留清理和真实外部 writeback 验收。

Worker budget smoke：

```bash
pnpm worker:budget-smoke
```

行为：

- 默认创建临时 PostgreSQL 数据库，执行 migration 和 seed。
- upsert 一条带 `cost:<usd>` 且超过 `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN` 的 `Development` smoke task。
- 要求 worker 不 claim、不创建 run，而是把任务切到 `Blocked`。
- 要求任务级 Progress / Workpad 写入 `Agent Status: Blocked.` 和预算超限原因。
- 成功时输出 `worker_budget_smoke=passed`、`task_id`、`estimated_cost_usd`、`max_estimated_cost_usd_per_run`、`budget_blocked=1` 和 `final_state=Blocked`。
- 结束后删除临时数据库。
- 设置 `WORKER_BUDGET_SMOKE_TEMP_DB=false` 后才会复用当前 `DATABASE_URL`。
- 该 smoke 只证明本地预算门禁和可见化阻断有效，不证明真实任务成本估算已经准确。

Worker workflow smoke：

```bash
pnpm worker:workflow-smoke
```

行为：

- 默认创建临时数据库、执行 migration/seed。
- upsert 一条 `Development` smoke task。
- 自动节点由 worker 依次推进：`Development -> Code Review`、`Code Review -> Human Review`、`In Merge -> Merged`、`Release Version -> Released`、`Deployment -> Deployed`。
- 人工 gate 由 `transitionTaskState` 模拟批准：`Human Review -> In Merge`、`Merged -> Release Version`、`Released -> Deployment`、`Deployed -> Done`。
- 成功时输出 `worker_workflow_smoke=passed`、`task_id`、自动 run 数量、`progress_items` 和 `final_state=Done`。
- 脚本要求每个自动 run 至少写入 Running 和 Completed 两条任务级 `agent_progress`，用于验证 Progress / Workpad 最小链路。
- 设置 `WORKER_WORKFLOW_SMOKE_TEMP_DB=false` 后才会复用当前 `DATABASE_URL`。
- 该 smoke 只证明本地状态机、worker 自动推进和人工 gate 转换能闭环，不替代真实 Plane 人工回写或真实 Codex 执行验收。

Worker Codex smoke：

```bash
pnpm worker:codex-smoke
```

行为：

- 默认创建临时 PostgreSQL 数据库和临时 git repo，执行 migration/seed。
- 默认使用 fake Codex CLI，验证 Worker `runOnce()` 可通过 `codex-cli` adapter 认领 Development task、准备 git-worktree workspace、写入 Codex events、任务级 Agent Events Progress、conversation ref，并推进到 `Code Review`。
- 设置 `WORKER_CODEX_SMOKE_USE_REAL_CODEX=true` 时会调用本机真实 `codex` CLI，在临时 repo 内创建 marker 文件并验证 marker 内容。该模式会消耗 Codex 额度；遇到额度、认证或模型错误时，脚本会输出 run failure reason 和最近 Codex event。
- 设置 `WORKER_CODEX_REAL_TIMEOUT_MS` 可调整真实 Codex 模式超时；设置 `WORKER_CODEX_SMOKE_ARGS_JSON` 可覆盖传给 `codex exec` 的额外参数。
- 该 smoke 仍不替代真实 Plane task 端到端验收；真实完成还必须验证 Plane state/comment writeback 和 task-source evidence。

Langfuse trace smoke：

```bash
LANGFUSE_ENABLED=true \
LANGFUSE_BASE_URL="https://cloud.langfuse.com" \
LANGFUSE_PUBLIC_KEY="<redacted>" \
LANGFUSE_SECRET_KEY="<redacted>" \
LANGFUSE_PROJECT_ID="<project-id>" \
pnpm langfuse:smoke
```

行为：

- 复用 worker 的 Langfuse SDK instrumentation，创建一条 `agent-run` smoke observation。
- 成功时输出 `langfuse_smoke=passed`、`trace_id` 和可选 `ui_url`。
- 该 smoke 验证 SDK credentials、base URL、trace emission 和 UI URL 生成逻辑；真实 UI 是否可打开仍应由 operator 抽查一次。
- 只有在 legacy external profile 或未来可选观测增强中使用 `ACP_CUTOVER_RUN_LANGFUSE_SMOKE=true` 时，才必须配置 `LANGFUSE_PROJECT_ID` 并同时输出 `trace_id` 和 `ui_url`；只有 trace id 或只有 URL 都不算该可选 trace 的完成证据。

Plane writeback smoke：

本地 API contract 先验证 Control Plane human gate 路由会调用 writeback helper，不触达真实 Plane：

```bash
pnpm plane:human-gate-writeback-smoke
```

真实 Plane API 写回验证使用独立 smoke：

```bash
PLANE_BASE_URL="https://plane.example.com" \
PLANE_WORKSPACE_SLUG="<workspace>" \
PLANE_PROJECT_ID="<project-id>" \
PLANE_API_KEY="<redacted>" \
PLANE_WRITEBACK_SMOKE_NEXT_STATE="Development" \
pnpm plane:writeback-smoke
```

默认只读取 project states，并确认 `PLANE_WRITEBACK_SMOKE_NEXT_STATE` 对应状态存在，不修改 Plane work item。

只读验证 comments list API 时，额外传入测试 work item：

```bash
PLANE_WRITEBACK_SMOKE_VERIFY_COMMENTS=true \
PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="<test-work-item-id>" \
pnpm plane:writeback-smoke
```

该模式仍不修改 Plane，只会回读 comments 并输出 `comments=verified` / `comment_count=<n>`。

真实写回验证必须显式开启：

```bash
PLANE_WRITEBACK_SMOKE_APPLY=true \
PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID="<test-work-item-id>" \
PLANE_WRITEBACK_SMOKE_NEXT_STATE="Development" \
PLANE_WRITEBACK_SMOKE_STATUS="Smoke Check" \
PLANE_WRITEBACK_SMOKE_SUMMARY="Agent Control Plane Plane writeback smoke." \
pnpm plane:writeback-smoke
```

apply 模式会 PATCH 指定 work item 的 state，并 POST 一条 `external_source=agent-control-plane` 的 smoke comment。写入后脚本会回读 work item 和 comments，确认 state 已变更、comment 包含 status/next state/summary 后才输出 `verified=true`。comment 会转义 HTML，避免把 smoke summary 当作富文本执行。

## Linear/Symphony 迁移

当前迁移脚本入口：

```bash
LINEAR_EXPORT_PATH="exports/linear-issues.json" \
PLANE_BASE_URL="https://plane.example.com" \
PLANE_API_KEY="<redacted>" \
PLANE_WORKSPACE_SLUG="<workspace>" \
PLANE_PROJECT_ID="<project-id>" \
PLANE_PROJECT_SLUG="token" \
pnpm linear:migrate
```

默认行为：

- 默认 dry-run，不创建 Plane work item。
- 支持 Linear export 为 issue 数组、`{ "issues": [...] }` 或 GraphQL `data.issues.nodes` 形态。
- 默认跳过 `Done` / `Canceled` / `Duplicate` 终态任务。
- 保留原 Linear identifier、Linear URL、原状态和 description 到 Plane description。
- 尝试按名称匹配 Plane state 和 label；缺失 label 会在 summary 中计数，但不会阻断 dry-run。

确认 dry-run 后才执行写入：

```bash
LINEAR_EXPORT_PATH="exports/linear-issues.json" \
LINEAR_MIGRATION_APPLY=true \
PLANE_BASE_URL="https://plane.example.com" \
PLANE_API_KEY="<redacted>" \
PLANE_WORKSPACE_SLUG="<workspace>" \
PLANE_PROJECT_ID="<project-id>" \
PLANE_PROJECT_SLUG="token" \
pnpm linear:migrate
```

写入后同步回 Control Plane：

```bash
pnpm plane:sync
```

`pnpm plane:sync` 同时会拉取 Plane work items 和 comments：

- work items 会 upsert 到本地 `tasks`。
- comments 会幂等写入 `feedback_items(source=plane_comment)`。
- 这条链路是 webhook 不完整或丢事件时的 polling fallback。
- `PLANE_SYNC_RETRY_ATTEMPTS` 和 `PLANE_SYNC_RETRY_DELAY_MS` 控制 Plane polling API retry；全局 labels/states/work items 读取在 retry 后仍失败时，本轮同步失败退出。
- `PLANE_SYNC_SERVER_DELTA=true` 时，`pnpm plane:sync` 会把当前 project cursor 作为 `updated_after` 传给 Plane work item list API；目标 Plane 不支持该参数时会自动回退全量 polling。任务 upsert 使用 delta 结果，comment polling 仍会扫描全量 work item id，避免旧 work item 的新 comment 因 issue `updated_at` 未变化而漏读。默认保持 `false`，直到真实 Plane 版本确认该参数稳定可用且确实降低返回量。
- 单个 work item comment 拉取失败时，summary 会返回 `commentFetchWarnings`；其他 task/comment 仍会同步，但本轮不会推进 cursor，避免漏掉失败 work item 的新评论。
- 配置 `MONITORING_ALERT_WEBHOOK_URL` 后，`commentFetchWarnings > 0` 会发送 Plane sync warning webhook；全局 sync failure 会发送 Plane sync critical webhook。payload 格式复用 `MONITORING_ALERT_FORMAT=generic|slack|email`。
- 同步完全成功后会写入 `app_settings(plane.sync_cursor.<projectSlug>)`；下一轮只 upsert cursor 之后变更的 task/comment。未开启 `PLANE_SYNC_SERVER_DELTA` 时仍会全量 list Plane work items；开启后 task list 会尝试服务端 `updated_after`，不支持时回退全量；comment list 仍基于全量 work item id 扫描并按 comment cursor 过滤。

切换前检查：

- 旧 Symphony poller 已停止或改为只读，避免 Linear 和 Plane 双写。
- Plane 中 `repo:<slug>` label 已预先创建，否则迁移任务会缺少 repo routing。
- `pnpm plane:sync` 后 `/tasks` 能看到迁移任务，并且 `repository_id` 不为空。
- 任意抽样任务保留了原 Linear URL 和 description。

## 监控

当前首页 `运行监控` 已提供基础指标：

- queue length：等待 agent 领取的任务数量。
- active runs：当前 queued / claimed / running 的 runs。
- human gates：等待人类判定的任务数量。
- blocked：Blocked 任务数量。
- stalled runs：已标记 stalled 的 runs。
- retry backlog：retryable failed/stalled 且仍在 backoff 窗口内的 runs。
- run success rate：最近 24h succeeded / finished runs。
- token/cost：累计 token 和 cost。
- 基础告警：queue 堆积、stalled、retry backlog、失败率、Blocked、成本阈值。
- 基础阈值配置：`app_settings` 中的 `monitoring.*` 配置优先，未配置时回退到 `MONITORING_QUEUE_BACKLOG_WARNING`、`MONITORING_STALLED_RUNS_CRITICAL`、`MONITORING_RETRY_BACKLOG_WARNING`、`MONITORING_FAILURE_RATE_CRITICAL`、`MONITORING_FAILURE_RATE_MIN_FINISHED`、`MONITORING_COST_WARNING_USD`、`MONITORING_RETRY_BACKOFF_MS`。
- 阈值 UI/API 动态配置：`/settings` 的 Monitoring Thresholds 表单和 `GET/PUT /api/monitoring/thresholds` 可动态读取/更新 queue、stalled、retry backlog、失败率、成本和 retry backoff 阈值；更新会写入 `audit_events(action=monitoring_thresholds.update)`。
- webhook 告警通知：配置 `MONITORING_ALERT_WEBHOOK_URL` 后，worker 每轮运行结束会把 active alerts POST 到该 URL；`MONITORING_ALERT_MIN_INTERVAL_MS` 用于同一 fingerprint 节流，默认 15 分钟；`MONITORING_ALERT_FORMAT=slack` 时发送 Slack Block Kit payload，`MONITORING_ALERT_FORMAT=email` 时发送 subject/text/html 邮件 payload。
- 告警失败重放：发送失败会 upsert 到 `monitoring_alert_notifications`；worker 每轮先重放到期记录，再发送当前告警。`MONITORING_ALERT_REPLAY_LIMIT` 控制每轮数量，`MONITORING_ALERT_RETRY_BACKOFF_MS` 控制失败后重试间隔。
- 趋势图：`/?trend=12h|24h|7d` 可查看 succeeded / failed / stalled run 柱状趋势；12h/24h 按小时聚合，7d 按天聚合。

告警失败队列查询：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane" \
psql "$DATABASE_URL" -c '
  select
    status,
    format,
    level,
    attempts,
    next_attempt_at,
    sent_at,
    left(fingerprint, 80) as fingerprint,
    left(coalesce(last_error, ''''), 120) as last_error
  from monitoring_alert_notifications
  order by updated_at desc
  limit 20;
'
```

判读：

- `pending` / `failed` 且 `next_attempt_at <= now()`：下一轮 worker 会优先重放。
- `sent`：重放或首次发送已经成功。
- 同一 `fingerprint + webhook_url` 只保留一条最新 payload，避免 webhook 长时间故障时无限堆积重复告警。

## Workspace 清理

Worker 会在执行前准备 workspace：

```text
WORKER_WORKSPACE_ROOT/<repo-slug>/<run-id>
```

当前策略：

- `WORKER_WORKSPACE_STRATEGY=auto`：优先使用 repository `local_path`；没有 `local_path` 时创建 `ephemeral` workspace。
- `WORKER_WORKSPACE_STRATEGY=git-worktree`：repository 有 `local_path` 时从本地仓库创建 per-run git worktree；没有 `local_path` 时回退为 `ephemeral`。
- `WORKER_WORKSPACE_STRATEGY=ephemeral`：总是创建临时目录。
- `WORKER_WORKSPACE_STRATEGY=local-path`：直接复用 repository `local_path`，不会被 cleanup 清理。

先 dry-run 查看候选：

```bash
WORKER_WORKSPACE_ROOT="/tmp/agent-control-plane-workspaces" \
WORKSPACE_CLEANUP_RETENTION_MS="86400000" \
WORKSPACE_CLEANUP_LIMIT="50" \
pnpm workspace:cleanup
```

确认后执行删除：

```bash
WORKER_WORKSPACE_ROOT="/tmp/agent-control-plane-workspaces" \
WORKSPACE_CLEANUP_RETENTION_MS="86400000" \
WORKSPACE_CLEANUP_LIMIT="50" \
WORKSPACE_CLEANUP_APPLY=true \
pnpm workspace:cleanup
```

行为：

- 只处理 `strategy=ephemeral` 或 `strategy=git-worktree`、run 已结束、`finished_at` 早于 retention 窗口、且尚未 `cleaned` 的 workspace。
- 只删除位于 `WORKER_WORKSPACE_ROOT` 下的路径；路径越界会跳过并返回 `outside_workspace_root`。
- apply 模式会清理 workspace，更新 `workspaces.status=cleaned` / `cleaned_at`，并写入 `run_events(event_type=workspace.cleaned)`。
- repository `local_path` 不会被清理。

边界：

- `git-worktree` 且 repository `local_path` 存在时，cleanup 会优先执行 `git worktree remove --force <workspace-path>` 和 `git worktree prune`；如果 Git 命令失败，会 fallback 到目录删除，避免坏 workspace 永久阻塞清理。
- fallback 删除后，如怀疑主仓库仍残留 metadata，用 `git -C <repository-local-path> worktree list` 检查，并手动执行 `git -C <repository-local-path> worktree prune`。
- 不要把 `WORKER_WORKSPACE_ROOT` 指到真实代码仓库父目录；cleanup 只做 root 内路径保护，不理解业务目录含义。

阈值 API 示例：

```bash
curl -fsS \
  -H "authorization: Bearer <operator-token>" \
  "http://127.0.0.1:3112/api/monitoring/thresholds"

curl -fsS \
  -X PUT \
  -H "authorization: Bearer <operator-token>" \
  -H "content-type: application/json" \
  -d '{
    "queueBacklogWarning": 20,
    "stalledRunsCritical": 2,
    "retryBacklogWarning": 5,
    "failureRateCritical": 0.25,
    "failureRateMinFinished": 10,
    "costWarningUsd": 25,
    "retryBackoffMs": 300000
  }' \
  "http://127.0.0.1:3112/api/monitoring/thresholds"
```

权限边界：

- API token 或 signed session 只证明请求来自 operator 入口。
- 阈值更新还要求当前 operator 具备 `owner` 或 `admin` 角色。
- 当前 operator 仍是本机最小模型；DB-backed operator user、signed session、`/session` 管理页面、`/users` 用户管理页面、owner/admin 用户创建/更新和细粒度页面/API ACL 已有最小闭环。

登录态边界：

- `/login` 和 `POST /api/auth/login` 使用 `ACP_OPERATOR_LOGIN_PASSWORD` 创建 `acp_operator_session` signed HttpOnly cookie。
- 登录会 upsert/read `users(external_provider=local, external_user_id=<operator name>)`，并用数据库 user id 写入 session/audit actor。
- `ACP_OPERATOR_SESSION_SECRET` 用于 cookie HMAC 签名，`ACP_OPERATOR_SESSION_TTL_SECONDS` 控制过期时间，默认 8 小时。
- `GET /api/auth/session` 可用于确认当前 API token 或 session cookie 对应的 operator context。
- `/session` 可用于浏览器侧查看当前认证方式、operator、session 过期时间，并退出当前 session。
- `/users` 和 `GET /api/users` 可用于查看 DB-backed operator users；`/users` 表单和 `POST /api/users` 可由 owner/admin 创建或更新用户，并记录 `audit_events(action=user.upsert)`。
- `/audit` 可用于查看控制面变更审计，支持 action/entity/actor/time window 筛选和聚合摘要。

在真实生产 smoke 完成前，生产环境只能按最小 smoke 运行，不应视为完整可运营状态。

## Secret 校验

本仓库提供最小 secret gate：

```bash
ACP_ENV=production pnpm secrets:validate
```

本仓库也提供本机 secret store/rotation 最小链路：

```bash
ACP_SECRET_ENV_FILE=.secrets/agent-control-plane.env pnpm secrets:rotate
ACP_ENV=production ACP_SECRET_ENV_FILE=.secrets/agent-control-plane.env pnpm secrets:validate
```

轮换行为：

- `pnpm secrets:rotate` 默认写入 `ACP_SECRET_ENV_FILE`，未设置时写入 `.secrets/agent-control-plane.env`。
- 生成 `ACP_OPERATOR_API_TOKEN`、`ACP_OPERATOR_LOGIN_PASSWORD`、`ACP_OPERATOR_SESSION_SECRET`、`PLANE_WEBHOOK_SECRET`。
- 同时写入 `ACP_SECRET_ROTATED_AT` 和 `ACP_SECRET_EXPIRES_AT`；`SECRET_ROTATION_TTL_DAYS` 控制有效期，默认 90 天。
- 文件权限强制为 `600`；`pnpm secrets:validate` 只会加载权限为 `600` 或 `400` 的 secret env file。
- 目标文件已存在时默认不覆盖；设置 `SECRET_ROTATION_OVERWRITE=true` 才会轮换已有文件。
- 每次实际轮换会追加一条 JSONL 审计到 `SECRET_ROTATION_AUDIT_FILE`，默认 `.secrets/rotation-audit.log`；设置为空字符串可关闭本机审计。
- 审计日志权限强制为 `600`，只记录 target、rotated_at、expires_at、变量名、actor 和 host，不记录 secret 值。
- 输出只展示目标文件和变量名，不打印 secret 值。

校验行为：

- 设置 `ACP_SECRET_ENV_FILE` 时，校验脚本会先加载该文件，再进入后续检查。
- `ACP_ENV=production` 或 `SECRET_VALIDATION_STRICT=true` 时进入严格模式。
- 严格模式要求 `DATABASE_URL`、`ACP_OPERATOR_API_TOKEN`、`PLANE_WEBHOOK_SECRET` 存在。
- 严格模式要求 `ACP_OPERATOR_LOGIN_PASSWORD` 和 `ACP_OPERATOR_SESSION_SECRET` 存在且不是弱密钥，用于浏览器 operator 登录。
- `PLANE_WRITEBACK_ENABLED=true` 时要求 Plane base URL、workspace、project 和 API key。
- `WORKER_EXECUTION_ADAPTER=openhands-cloud` 时要求 OpenHands base URL 和 API key。
- `LANGFUSE_ENABLED=true` 时要求 Langfuse base URL、project id、public key 和 secret key。
- `MONITORING_ALERT_WEBHOOK_URL` 存在时，`MONITORING_ALERT_FORMAT` 必须是 `generic`、`slack` 或 `email`。
- `ACP_SECRET_EXPIRES_AT` 已过期时会失败；距离过期小于等于 `SECRET_EXPIRY_WARNING_DAYS` 时会输出 warning，默认 14 天。
- 会阻断明显弱密钥，例如 `secret`、`changeme`、`local-dev-token` 或长度过短的 token。
- 输出只展示脱敏值或变量名，不打印完整 secret。

外部 secret manager 接入：

- 设置 `ACP_SECRET_COMMAND` 时，`validate-secrets.sh`、`deploy-compose.sh`、`smoke-production.sh`、`external-smoke-preflight.sh`、`cutover-check.sh` 和 `completion-final.sh` 会执行该命令，并把 stdout 当作 dotenv 加载；`external-smoke-preflight.sh` / `completion-final.sh` / `smoke-production.sh` 会先加载 secret env file / command，再运行预检、最终门禁或 secret validation。
- 命令必须只输出 `KEY=value` / `KEY="value"` 形式，不要输出日志或明文调试信息。
- `ACP_SECRET_ENV_FILE` 会先加载，`ACP_SECRET_COMMAND` 后加载；命令输出可以覆盖本地文件中的值。
- 命令失败会阻断校验、部署、smoke 或 cutover。

外部 secret provider smoke：

```bash
ACP_SECRET_COMMAND='sops -d .secrets/agent-control-plane.env' \
ACP_ENV=production \
pnpm secrets:provider-smoke
```

行为：

- 执行 `ACP_SECRET_COMMAND`，把 stdout 保存为临时 `600` dotenv 文件。
- 检查输出非空且为 dotenv-compatible，只打印变量名，不打印 secret 值。
- 用临时 provider 输出执行 `scripts/validate-secrets.sh`，默认 `ACP_ENV=production`。
- 失败会阻断 cutover；设置 `ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE=true` 后，`pnpm cutover:check` 会自动执行该 smoke。

示例：

```bash
# 1Password CLI 例：由 op 注入环境，再筛出本系统前缀。
ACP_SECRET_COMMAND='op run --env-file .secrets/op.env -- printenv | grep -E "^(ACP_|PLANE_|OPENHANDS_|LANGFUSE_|DATABASE_URL=)"' \
ACP_ENV=production \
pnpm secrets:validate

# SOPS 例：解密 dotenv 文件。
ACP_SECRET_COMMAND='sops -d .secrets/agent-control-plane.env' \
ACP_ENV=production \
pnpm secrets:validate
```

仍可升级：

- 为 1Password、Vault、SOPS 或云厂商审计 API 增加 provider-specific adapter；当前已支持用 `SECRET_PROVIDER_AUDIT_FILE` 读取 provider 导出的 JSONL，也支持用 `SECRET_PROVIDER_AUDIT_COMMAND` 直接执行 provider CLI/API wrapper 并校验 stdout JSONL，但尚未在真实供应商账号/API 下验收。

Provider-side 轮换审计 smoke：

```bash
SECRET_PROVIDER_AUDIT_FILE=".secrets/provider-audit.jsonl" \
pnpm secrets:provider-audit-smoke
```

或直接执行 provider CLI/API wrapper：

```bash
SECRET_PROVIDER_AUDIT_COMMAND='op events-api export --format jsonl --since 2026-06-01T00:00:00Z' \
pnpm secrets:provider-audit-smoke
```

行为：

- `SECRET_PROVIDER_AUDIT_FILE` 和 `SECRET_PROVIDER_AUDIT_COMMAND` 二选一；同时设置会失败，避免误读旧文件。
- 使用文件输入时，要求 `SECRET_PROVIDER_AUDIT_FILE` 存在、非空，权限为 `600` 或 `400`。
- 使用命令输入时，脚本执行 `SECRET_PROVIDER_AUDIT_COMMAND`，把 stdout 写入临时 `600` JSONL 文件后校验；stderr 不进入审计结果，命令失败会阻断 smoke。
- 要求文件为 JSONL，每行一个 provider 审计事件。
- 默认用 `SECRET_PROVIDER_AUDIT_EVENT_PATTERN="rotat|secret_rotation"` 匹配轮换事件；不同供应商字段不同，可覆盖该正则。
- 可设置 `SECRET_PROVIDER_AUDIT_SINCE=<ISO timestamp>`，要求至少一个匹配事件晚于该时间。
- 会扫描当前环境中的 secret/token/password/api key 值，若审计文件包含当前 secret 值会失败；同时阻断私钥/API key 形态的明文。
- 只输出事件数量、匹配数量和最新事件时间，不打印审计事件全文。
- 该 smoke 已支持 provider CLI/API wrapper，但仍是通用 JSONL harness；真实切换前必须用真实供应商账号/API 跑一次。

## Cutover Gate

正式从 Linear/Symphony 切到 Plane/Control Plane 前执行：

```bash
pnpm cutover:check
```

门禁要求：

- `PLANE_WRITEBACK_ENABLED=true`，并配置 Plane base URL、workspace、project、API key 和 webhook secret。
- 已完成真实 Plane 人工 gate/rework 状态和 comment 回写 smoke，并设置 `ACP_CUTOVER_PLANE_WRITEBACK_SMOKE_PASSED=true` 和 `ACP_CUTOVER_PLANE_WRITEBACK_EVIDENCE=<Plane work item/comment 记录>`；或者设置 `ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE=true` 让 cutover gate 自动执行 `pnpm plane:writeback-smoke`。
- 默认 `codex-cli` profile 必须完成真实 Codex Worker run，并在 Control Plane 中留下 run events、Progress / Workpad、prompt release、workspace 和 summary evidence。
- OpenHands conversation smoke 和 Langfuse trace smoke 只在 legacy external profile 中要求；显式启用时，人工提供的 OpenHands / Langfuse URL 必须是可审计的真实外部 URL。
- Plane base URL 必须是可审计 URL；`cutover:check` 会拒绝 `localhost`、`127/8`、`0.0.0.0` 和 `::1`，除非处于受控本地 rehearsal。
- 旧 Linear/Symphony poller 已冻结为只读或停用，并设置 `ACP_CUTOVER_LEGACY_POLLER_READONLY=true` 和 `ACP_CUTOVER_LEGACY_POLLER_EVIDENCE=<停机命令、部署记录或截图链接>`。
- Linear 已确认只保留归档用途，并设置 `ACP_CUTOVER_LINEAR_ARCHIVE_CONFIRMED=true` 和 `ACP_CUTOVER_LINEAR_ARCHIVE_EVIDENCE=<只读/归档确认记录>`。
- 可选设置 `ACP_CUTOVER_MANUAL_EVIDENCE_SUMMARY=<变更单/文档/issue 链接>`，把本次人工证据汇总到 gate 输出中。
- 默认会执行 `scripts/validate-secrets.sh`；secret validate 会拒绝模板占位值，且不会执行占位 `ACP_SECRET_COMMAND`。只有在外部流水线已经完成等价 secret gate 时，才设置 `ACP_CUTOVER_SKIP_SECRET_VALIDATE=true`。
- 设置 `ACP_CUTOVER_RUN_PRODUCTION_SMOKE=true` 后，cutover gate 会先执行 `scripts/smoke-production.sh`，默认验证 Control Plane API、认证链路和 readiness；`ACP_SMOKE_EXTERNAL=true` 时再启用外部依赖只读探针。默认 `codex-cli` profile 不要求 OpenHands/Langfuse 探针。
- 设置 `ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-plane-writeback.sh`，并要求 `PLANE_WRITEBACK_SMOKE_APPLY=true` 和 `PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID`，避免 dry-run 被误判为真实写回；脚本会写后回读验证 Plane state/comment。
- 设置 `ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE=true` 后，cutover gate 会按 `WORKER_EXECUTION_ADAPTER` 执行 `pnpm codex:adapter-smoke` 或 `pnpm codex:app-server-smoke`，验证 Codex adapter 基础事件映射。
- 设置 `ACP_CUTOVER_RUN_OPENHANDS_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-openhands.sh`，并要求 `OPENHANDS_SMOKE_CREATE_CONVERSATION=true`，避免只读 probe 被误判为真实 conversation smoke；该项仅属于 legacy external profile。
- 设置 `ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-openhands-adapter.sh`，验证 worker OpenHands adapter 能拿到成功 terminal status、conversation ref、event summary 和 role next state；该项仅属于 legacy external profile。
- 设置 `ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-openhands-db.sh`，验证数据库驱动 worker run 能写入 prompt release、conversation ref、workspace event、OpenHands status event 和 next state，并把 `prompt_release_id`、正数 `trace_refs` 和首个 `trace_ui_url` 写入 cutover report；`LANGFUSE_ENABLED=true` 时还会要求 run detail 写入 `trace_refs(provider=langfuse)`。该项仅属于 legacy external profile；生产切换建议把 `OPENHANDS_DB_SMOKE_PROJECT_SLUG` 指向专用 smoke project，避免混入真实待处理任务。
- 设置 `ACP_CUTOVER_RUN_LANGFUSE_SMOKE=true` 后，cutover gate 会执行 `pnpm langfuse:smoke`，要求 `LANGFUSE_ENABLED=true` 且 credentials 存在，并拒绝 `LANGFUSE_SMOKE_DRY_RUN=true`；该项仅属于 legacy external profile 或未来可选观测增强。
- 设置 `ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-task-source.sh`，审计非终态自动派发任务的 URL 来源、repo routing 和 run evidence。默认 `codex-cli` profile 应以 Control Plane run、Codex run events、Progress / Workpad、prompt release 和 workspace 证明执行，conversation/trace evidence 只属于 legacy external profile。
- 设置 `ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-worker-crash.sh`，创建临时数据库并验证过期 `running` run 会先标记 `stalled`，再以 `attempt=2` 重新认领同一任务推进到 `Code Review`。该 smoke 是本地恢复机制门禁，不替代真实 Codex 长任务崩溃、真实 workspace 残留清理和真实外部 writeback 验收。
- 设置 `ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-worker-budget.sh`，创建临时数据库并验证预算超限 `Development` task 不会被 claim，而是自动进入 `Blocked` 并写入 Progress / Workpad。该 smoke 是本地预算门禁，不替代真实成本估算调优。
- 设置 `ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-worker-workflow.sh`，创建临时数据库并验证完整状态机从 `Development` 跑到 `Done`，自动节点由 worker 执行，人工 gate 由本地 transition API 模拟。该 smoke 是本地 workflow 门禁，不替代真实 Plane 人工回写或真实 Codex 执行验收。
- 设置 `ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-secret-provider.sh`，验证 `ACP_SECRET_COMMAND` 真实输出可通过生产 secret gate。
- 设置 `ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE=true` 后，cutover gate 会执行 `scripts/smoke-secret-provider-audit.sh`，验证 provider audit JSONL 中存在轮换事件且没有明显 secret 泄露；可用 `SECRET_PROVIDER_AUDIT_FILE` 指向已导出的 JSONL，也可用 `SECRET_PROVIDER_AUDIT_COMMAND` 在 gate 内直接拉取真实供应商审计事件。
- 设置 `ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT=true` 后，cutover gate 会执行 `scripts/external-smoke-preflight.sh`，把 `preflight_id`、`ready_count` 和 `missing_count` 写入 cutover report；最终 `completion:audit` 要求 codex profile evidence 为 `preflight_id=<id>;ready_count=7;missing_count=0`（未跑 production smoke 时为 6），legacy external profile 为 `ready_count=9;missing_count=0`。本地 `cutover:rehearsal` 不跑 external preflight，因此 rehearsal report 不能作为最终完成证据。
- 可选设置 `ACP_CUTOVER_REPORT_ID=<change-or-final-run-id>`，把 cutover report 绑定到外部变更单、final run 或 cutover issue；留空时脚本会生成非敏感 report id。
- 可选设置 `ACP_CUTOVER_REPORT_FILE=/secure/path/cutover-report.json`，gate 成功或失败都会写出 JSON 报告；报告包含 `reportId`、`completionFinalRunId`、readiness、errors、warnings、gate 状态、smoke 开关、evidence 摘要和非敏感运行配置，不包含 API key 或 secret。已存在的 report 默认不会被覆盖；只有明确设置 `ACP_CUTOVER_REPORT_OVERWRITE=true` 时，`cutover:check` 才会替换该文件。手工 Plane/OpenHands/Langfuse/task-source evidence 可写在 `ACP_SECRET_ENV_FILE` 里，`cutover:check` 加载后会绑定到 report；自动 smoke 路径产生的新 evidence 会覆盖手工默认值。
- 可用 `pnpm cutover:report-smoke` 本地验证失败路径 report 契约没有被改坏；该 smoke 不需要真实外部账号，会验证 report 写出、权限、基本 JSON 结构，以及手工 evidence 从 secret env file 进入 cutover report。

通过输出：

```text
cutover_readiness=passed
plane_writeback=true
legacy_poller_readonly=true
linear_archive=true
production_smoke=true|false
plane_writeback_smoke=true|false
openhands_smoke=true|false
openhands_adapter_smoke=true|false
openhands_db_smoke=true|false
langfuse_smoke=true|false
task_source_smoke=true|false
worker_crash_smoke=true|false
worker_budget_smoke=true|false
worker_workflow_smoke=true|false
secret_provider_smoke=true|false
secret_provider_audit_smoke=true|false
external_preflight_smoke=true|false
production_smoke_evidence=<external Plane/OpenHands/Langfuse probe URL and status evidence>
plane_writeback_evidence=<Plane work item/comment evidence>
openhands_conversation_evidence=ui_url=<OpenHands conversation URL>;conversation_id=<id>;payload_file=<owner-only raw payload file>
openhands_adapter_evidence=ui_url=<OpenHands adapter conversation URL>;conversation_id=<id>;next_state=<state>
openhands_db_evidence=<run id/conversation id/ui_url/prompt_release_id/trace_refs/trace_ui_url/next state/events>
langfuse_trace_evidence=<trace_id/ui_url>
task_source_evidence=<checked/routed/run/event/progress/prompt/workspace/conversation/trace counts>
worker_crash_evidence=<stale/recovered run evidence>
worker_budget_evidence=<task/budget/final state evidence>
worker_workflow_evidence=<task/run/final state evidence>
secret_provider_evidence=<variable count and validation status>
secret_provider_audit_evidence=<audit source/event counts>
external_preflight_evidence=<ready/missing counts>
legacy_poller_evidence=<poller readonly/stop evidence>
linear_archive_evidence=<Linear archive evidence>
manual_evidence=<summary-or-recorded>
```

设置 `ACP_CUTOVER_REPORT_FILE` 时，输出额外包含：

```text
cutover_report_file=<path>
```

失败时必须先处理所有 `error:`。带 `warning:` 时允许继续评估，但默认 `codex-cli` profile 的生产切换必须已经具备 Codex run evidence、Plane writeback、task-source、secret provider 和 provider audit。自动 smoke 路径会从 smoke stdout 中提取 URL、run id、work item id、任务来源计数、崩溃恢复 run id、预算阻断 final state、完整工作流 final state、secret provider 变量数量和 provider audit 事件数量等 evidence 并写入通过输出；legacy external profile 才要求 OpenHands/Langfuse URL evidence。这些 evidence 应复制到变更单或 cutover issue。`ACP_CUTOVER_RUN_PRODUCTION_SMOKE=true` 只证明 smoke harness 和只读探针通过，不替代真实 Codex agent run、真实 Plane writeback、task-source 审计、真实 secret provider、真实 provider audit、真实崩溃恢复、预算阻断和完整工作流的人工或端到端验收；默认 profile 需要分别打开 `ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE`、`ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE`、`ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE`、`ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE`、`ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE`、`ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE` 和 `ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE`。`ACP_CUTOVER_RUN_OPENHANDS_*` 和 `ACP_CUTOVER_RUN_LANGFUSE_SMOKE` 只属于 optional/legacy profile。

完成度审计：

```bash
ACP_COMPLETION_AUDIT_REPORT_FILE=/secure/path/cutover-report.json pnpm completion:audit
```

行为：

- 读取 `ACP_COMPLETION_AUDIT_REPORT_FILE`，未设置时回退 `ACP_CUTOVER_REPORT_FILE`。
- 要求 report 文件权限为 `0600` 或 `0400`，`readiness=passed`，`errors=[]`、`warnings=[]`，且 `generatedAt` 是 ISO 时间并默认在 24 小时内。
- 要求 Plane writeback enabled、legacy poller readonly、Linear archive confirmed 三个 cutover gate 都为 true。
- 默认 `codex-cli` profile 要求 production、Plane writeback、Codex Worker run、task-source、worker crash/budget/workflow、secret provider、provider audit 和 external preflight smoke flags 都为 true。
- 默认 `codex-cli` profile 要求 report config 显示 `WORKER_EXECUTION_ADAPTER=codex-cli` 或 `codex-app-server`、未跳过 secret validate、production smoke 已打开必要只读探针。
- 默认 `codex-cli` profile 要求真实 Codex Worker run、Control Plane run events、Progress / Workpad、prompt release、workspace、Plane writeback、production smoke、task-source、secret provider、provider audit、external preflight、旧 poller 冻结、Linear 归档和 worker crash/budget/workflow evidence。OpenHands conversation/adapter/DB run 和 Langfuse trace 只在 legacy external profile 中强制。
- 默认拒绝 `localhost`、任意 `127/8` loopback、`0.0.0.0`、`::1`、`example.com`、`owner/repo`、`<...>`、`YYYY-MM-DD` 和 `cutover-rehearsal mock` 证据，覆盖 URL 和 run id、task id、provider、preflight id、日期等标量字段，避免把本地 rehearsal 或模板样例当成生产完成；本机 self-host 调试时可临时设置 `ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE=true`。
- 默认有缺口时退出非 0；若只想生成缺口清单，可设置 `ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE=true`。

最终完成审计：

```bash
ACP_SECRET_ENV_FILE=.secrets/completion-final.env \
ACP_CUTOVER_REPORT_FILE=<cutover-report.json> \
pnpm completion:final
ACP_COMPLETION_AUDIT_REPORT_FILE=<cutover-report.json> pnpm completion:audit
pnpm completion:audit-smoke
pnpm completion:gap-smoke
pnpm completion:final-env-template-smoke
pnpm completion:final-smoke
```

`completion:final` 负责生成并审计本次真实 cutover report；`completion:audit` 负责对已有 report 做只读复核。`completion:audit` 不接受 rehearsal mock、`not-run`、`unknown`、缺 `reportId`、report 权限过宽、过期 `generatedAt`、默认本机 URL/loopback URL 或模板样例 URL / 占位符作为真实完成证据；模板占位拒绝也覆盖 run id、task id、provider、preflight id、日期等非 URL 字段。在默认 `codex-cli` profile 中，关键 evidence 至少要能证明 report 文件 owner-only、report 是 24 小时内生成的真实 cutover report、Codex Worker run 真实执行、Control Plane `run_events` / Progress / Workpad / prompt release / workspace 可追踪、Plane `work_item_id` / `state` / `comment=created` / `verified=true` 写回、production smoke 通过、task-source `checked>0` 且无 Linear URL，并且 Plane URL、repo routing、run、run events、progress/workpad、prompt release 和 workspace 证据覆盖每一条 checked 任务、secret provider 有 `variables>0` 且 `validation=passed`、provider audit 有 `source`、`events>0`、`matched_events>0` 和 ISO 时间戳 `newest_event_at`、旧 poller 有 disabled/stopped/readonly/frozen 等状态词和日期、Linear 归档有 archived/read-only 等状态词和日期、worker crash `recovered_attempt=2`、worker budget `budget_blocked=true|1` 且 `final_state=Blocked`、worker workflow `runs>0` 且 `final_state=Done`，以及 external preflight `preflight_id`、`ready_count`、`missing_count=0`。OpenHands payload、OpenHands adapter、OpenHands DB run 和 Langfuse trace 结构化证据只属于 legacy external profile。完成审计只信 cutover JSON report 内的 evidence，不接受通过环境变量临时补全缺失证据。只有 completion final 或 completion audit 基于真实 report 通过，才可以把“按文档完成开发”视为已具备可审计完成证据。

补充：在 `completion:final` 调用链中，`completion:audit` 还会要求 report 的 external preflight `preflight_id` 匹配本次 `ACP_EXTERNAL_PREFLIGHT_ID`；`completion:audit-smoke` 已覆盖 external preflight id 错配必须失败。

补充：`completion:audit-smoke` 也覆盖 fresh report 携带陈旧 evidence 必须失败，具体包括 provider audit `newest_event_at`、legacy poller 冻结日期和 Linear archive 日期超出审计窗口。

## Cutover Rehearsal

本地一键演练：

```bash
pnpm cutover:codex-rehearsal
pnpm cutover:rehearsal
```

行为：

- `pnpm cutover:codex-rehearsal` 启动本地 mock Plane 和临时数据库，按默认 `codex-cli` profile 调用 `pnpm cutover:check`，自动跑 Plane writeback、Codex adapter、task-source、worker crash/budget/workflow、secret provider 和 provider audit smoke；它会确认 OpenHands/Langfuse legacy smoke 未参与默认 profile，并要求 `completion:audit` 拒绝本地 mock report。
- 启动临时 mock Plane，以及 legacy external profile 所需的 mock OpenHands / Langfuse HTTP 服务。
- 显式设置 `ACP_CUTOVER_ALLOW_LOOPBACK_URLS=true`，只让本地 mock URL 通过 `cutover:check`；最终 `completion:final` 会拒绝该开关，生产 cutover 不得使用。
- 生成临时 provider audit JSONL。
- 调用 `pnpm cutover:check`，并打开 Plane writeback、worker crash、worker budget、worker workflow 和 provider audit smoke；legacy external profile 还会打开 OpenHands conversation、OpenHands adapter、Langfuse trace 等 smoke。
- 当前 rehearsal 显式使用 `legacy-openhands` profile 并执行 DB-driven OpenHands smoke，这是 legacy harness 行为；默认 Codex-first 完成证据必须来自真实 Codex Worker run，而不是该 rehearsal。设置 `ACP_CUTOVER_REHEARSAL_RUN_DB_SMOKE=false` 才跳过该链路。
- 生成临时 dotenv 并执行 secret provider smoke；report 中 `secretProvider` evidence 应包含变量数量和 `validation=passed`。这只验证脚本契约，不代表真实供应商 provider 已验收。
- 自动生成并校验 cutover JSON report，确认 readiness、smoke flags 和关键 evidence 已写入；默认使用临时报告并在结束后删除，设置 `ACP_CUTOVER_REHEARSAL_REPORT_FILE=/path/report.json` 时保留报告并输出路径。
- 执行 `completion:audit` 并要求它拒绝 rehearsal mock report，避免把本地 rehearsal 当成生产完成证据。
- rehearsal 会为 legacy poller 和 Linear archive 注入 `cutover-rehearsal mock` evidence，只用于通过本地 gate 编排验证；真实 cutover 必须替换成实际停机/只读/归档证据。
- 结束后清理临时 mock 服务和审计文件。

边界：

- `pnpm cutover:rehearsal` 只证明 cutover gate 和 smoke harness 编排可重复执行。
- 它使用 mock 外部服务，不证明真实 Codex Worker run、真实 Plane project、真实 secret provider command 或真实 provider audit API 已验收；legacy external profile 也不证明真实 OpenHands Cloud 或真实 Langfuse UI 已验收。
- 它默认设置 `ACP_CUTOVER_SKIP_SECRET_VALIDATE=true`，避免本地 mock 演练误用生产 secret gate。

真实完整演练仍按下面顺序手工执行并留证：

1. 停止旧 Symphony worker，或确认旧 Linear/Symphony poller 只读。
2. 导出 Linear 未完成任务，执行 `pnpm linear:migrate` dry-run，确认状态、标题、description、原 Linear URL 和 repo label 映射正确。
3. 设置 `LINEAR_MIGRATION_APPLY=true` 写入 Plane test project。
4. 执行 `pnpm plane:sync`，确认 `/tasks` 能看到迁移任务，且 `repository_id` 不为空。
5. 在 staging/真实测试任务上执行一次 Development run，确认 Worker 使用 `codex-cli` 执行，run detail 有 Codex events、prompt release、workspace、Progress / Workpad 和 summary。
6. 执行 `PLANE_WRITEBACK_SMOKE_APPLY=true pnpm plane:writeback-smoke`，确认 Plane state/comment 写后回读通过。
7. 执行带真实 Codex profile 的 `pnpm cutover:check`。
8. 创建一个新 Plane 测试任务，执行 `pnpm plane:sync` 或触发 Plane webhook，确认它进入 Control Plane `tasks`，且 `url` 指向 Plane、`repository_id` 不为空。
9. 执行 `pnpm task-source:smoke`，或在 cutover gate 中设置 `ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE=true`，确认该任务只由 Control Plane worker claim/run，不再从 Linear/Symphony 派发；Linear 不应出现新的 agent 进度留言或状态推进。

任务来源抽查 SQL：

```sql
select identifier, title, state, url, repository_id, last_synced_at
from tasks
where state not in ('Done', 'Canceled', 'Duplicate')
order by updated_at desc
limit 20;
```

判定：

- `url` 应指向 Plane work item，而不是 Linear issue。
- `repository_id` 不应为空；为空说明 repo label/字段缺失，worker 不应派发。
- 新建测试任务应有对应 `runs` 记录，且 `runs.status`、`run_events`、Progress / Workpad、prompt release 和 workspace 能串起来。
- 旧 Linear/Symphony poller 停用证据必须和本次 cutover report 一起归档。

演练通过的最低证据：

- `cutover_readiness=passed`。
- 一个真实 Codex Worker run，含 run events、Progress / Workpad、prompt release、workspace 和 summary。
- 一个真实 Plane work item 的 state/comment 回写记录。
- 一条迁移任务在 Control Plane 中有 task、run、Codex run events 和 Progress / Workpad。
- 一条 cutover 后新建 Plane 任务在 Control Plane 中有 Plane URL、repo routing、run、Codex run events 和 Progress / Workpad。
- 旧 Linear/Symphony poller 已停止或只读的操作记录。

## Plane Polling Sync

Webhook 是常规事件入口；cutover、漏投回放和低频一致性校验必须使用 polling sync：

```bash
ACP_SECRET_ENV_FILE=/path/to/agent-control-plane.env pnpm plane:sync
```

要求：

- `ACP_SECRET_ENV_FILE` 使用安全 dotenv parser，支持 `export KEY=value`，拒绝 `$(...)` 和反引号命令替换。
- env file 必须提供 `PLANE_BASE_URL`、`PLANE_API_KEY`、`PLANE_WORKSPACE_SLUG`、`PLANE_PROJECT_ID` 和 `PLANE_PROJECT_SLUG`。
- 命令会拉取 Plane work items/comments，写入 Control Plane DB，并更新 `app_settings` 中的 project sync cursor。
- 可用 `PLANE_SYNC_CURSOR=<iso-time>` 指定回放起点；可用 `PLANE_SYNC_SERVER_DELTA=false` 强制全量拉取后本地按 cursor 过滤。

## 事故止血

暂停 agent 派发：

```bash
docker compose --profile worker stop worker
```

恢复 worker：

```bash
docker compose --profile worker up -d --no-build worker
```

查看状态：

```bash
docker compose ps
docker compose logs --tail=200 web
docker compose logs --tail=200 worker
```
