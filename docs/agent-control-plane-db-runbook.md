# Agent Control Plane Database Runbook

## 目标

本文记录当前 Agent Control Plane 的 PostgreSQL 初始化、迁移和 seed 流程。

## 默认连接

本机默认连接串：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane"
```

当前本机已验证的容器：

```bash
agent-control-plane-postgres 0.0.0.0:54329->5432/tcp
```

## 命令

校验 Prisma schema：

```bash
pnpm db:validate
```

执行 migration：

```bash
pnpm db:migrate
```

执行 seed：

```bash
pnpm db:seed
```

一次性初始化：

```bash
pnpm db:migrate && pnpm db:seed
```

如果本地 `agent_control_plane` 数据库已经存在旧实验表或旧 `_prisma_migrations` 记录，`pnpm db:migrate`
可能因为历史状态不一致失败。不要直接删库；先切到新的测试库验证：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm db:migrate
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm db:seed
```

确认无误后，再决定是新建正式库，还是用 `prisma migrate resolve` 修复旧库迁移记录。

## 当前 migration

当前 migrations：

```text
packages/db/prisma/migrations/0001_initial/migration.sql
packages/db/prisma/migrations/0002_role_status/migration.sql
packages/db/prisma/migrations/0003_prompt_binding_approval/migration.sql
packages/db/prisma/migrations/0004_legacy_enum_compat/migration.sql
packages/db/prisma/migrations/0005_app_settings/migration.sql
packages/db/prisma/migrations/0006_monitoring_alert_notifications/migration.sql
packages/db/prisma/migrations/0007_task_estimated_cost/migration.sql
packages/db/prisma/migrations/0008_agent_reasoning_high_default/migration.sql
```

`0001_initial` 覆盖核心表：

- teams
- projects
- repositories
- tasks
- roles
- agent_definitions
- prompt_components
- prompt_bindings
- prompt_releases
- runs
- workspaces
- conversation_refs
- trace_refs
- run_events
- feedback_items
- users
- audit_events

`0002_role_status` 为 `roles` 增加 `status` 字段，用于 Project Settings 中归档角色。

`0003_prompt_binding_approval` 将 `prompt_bindings.status` 默认值改为 `pending`，并 seed 本地 operator：

```text
00000000-0000-4000-8000-000000000901 local-operator
```

`0004_legacy_enum_compat` 只处理旧实验库兼容：如果数据库里仍存在早期 Prisma enum
`TaskState` / `RunStatus`，则条件追加 `Duplicate` / `stalled` enum value。当前 text-state
schema 不受影响。

`0005_app_settings` 增加 `app_settings` 表，用于运行期配置。当前保存 `monitoring.*` 告警阈值，供 dashboard/readiness、`/settings` Monitoring Thresholds 表单和 `GET/PUT /api/monitoring/thresholds` 读取；DB 配置优先于 `MONITORING_*` 环境变量。

`0006_monitoring_alert_notifications` 增加 `monitoring_alert_notifications` 表，用于记录 webhook 告警发送失败的 payload、fingerprint、webhook URL、payload format、下一次尝试时间和 attempts。`fingerprint + webhook_url` 唯一，避免同一告警在 webhook 故障期间无限堆积。Worker 每轮会先重放到期记录，再发送当前 active alerts。

`0007_task_estimated_cost` 为 `tasks` 增加 `estimated_cost_usd` 字段，用于记录从 Plane `cost:<usd>` label 或后续平台字段同步来的单 run 估算成本。

`0008_agent_reasoning_high_default` 是历史迁移，曾将 `agent_definitions.reasoning_effort` 默认值切到 `high`。

2026-06-19 已在独立验证库 `agent_control_plane_compat_verify` 跑通 `0001` 到 `0009`
migration，并执行 seed 成功。若已有本地 `agent_control_plane` 存在历史失败 migration 记录，先按上文
独立库验证，不要直接在该库上继续 deploy。

复测命令：

```bash
docker exec agent-control-plane-postgres sh -lc \
  'dropdb -U agent --if-exists agent_control_plane_compat_verify && createdb -U agent agent_control_plane_compat_verify'

DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_compat_verify" pnpm db:migrate
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_compat_verify" pnpm db:seed
```

注意：`0004_legacy_enum_compat` 只为历史实验库兜底。当前 schema 的 task state / run status 查询已按 `state::text` / `status::text` 兼容旧 enum 和当前 text 字段，并把 `Duplicate` 视为终态，避免被 worker 再次 claim。

告警失败队列运维查询：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane" \
psql "$DATABASE_URL" -c '
  select status, format, level, attempts, next_attempt_at, sent_at, left(last_error, 120) as last_error
  from monitoring_alert_notifications
  order by updated_at desc
  limit 20;
'
```

## Seed 基线

Seed 文件：

```text
packages/db/prisma/seed.sql
```

Seed 后应至少存在：

```text
teams=1
repositories=3
roles=6
agent_definitions=6
prompt_components=3
prompt_bindings=3
tasks=1
```

默认数据：

- team: `token-team`
- project: `token`
- repos: `crs-src`, `sub3`, `traffic`
- roles: `intake`, `development`, `code_review`, `merge`, `release`, `deploy`
- demo task: `TOK-1`

## 验证记录

2026-06-19 已在独立测试库验证：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm db:migrate
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm db:seed
```

计数结果：

```text
1,3,6,6,3,3,1
```

顺序为：

```text
teams,repositories,roles,agent_definitions,prompt_components,prompt_bindings,tasks
```

Seed 已验证可重复执行：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm db:seed
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm db:seed
```

## Web / Worker 验证

使用测试库启动 Web：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm dev
```

Operator API token / signed session：

- `ACP_OPERATOR_API_TOKEN` 为空时，operator API 不启用 token 门禁，方便本机 smoke；`CONTROL_PLANE_API_TOKEN` 保留为旧变量 fallback。
- `ACP_OPERATOR_API_TOKEN` 有值时，除 `/api/readiness`、`/api/plane/webhook`、`/api/auth/login` 和 `/api/auth/logout` 外，所有 `/api/*` 请求必须提供 `Authorization: Bearer <token>`、`x-acp-operator-token` 或有效 `acp_operator_session` signed cookie。
- `/login` 和 `POST /api/auth/login` 使用 `ACP_OPERATOR_LOGIN_PASSWORD` 创建 signed HttpOnly cookie；`ACP_OPERATOR_SESSION_SECRET` 用于 HMAC 签名，`ACP_OPERATOR_SESSION_TTL_SECONDS` 控制过期时间。
- `GET /api/auth/session` 返回当前 token/session 对应的 operator context。
- proxy 会根据 operator roles 做页面/API 级权限控制：owner/admin 全通；prompt roles 可进入 prompt surfaces；viewer 只能访问 dashboard、tasks、runs、audit、session 等只读观察面。
- `/api/tasks` 的 `GET` 为只读观察面；`transition`、`rework`、`feedback` 等 `POST` 任务变更接口仅 owner/admin 可用。
- Plane webhook 继续使用 `PLANE_WEBHOOK_SECRET` 和 `x-plane-signature` 验签，不走 operator token。

示例：

```bash
ACP_OPERATOR_API_TOKEN="local-dev-token" \
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" \
pnpm dev

curl -sS \
  -H "authorization: Bearer local-dev-token" \
  "http://127.0.0.1:3112/api/runs?limit=5"

curl -sS \
  -H "authorization: Bearer local-dev-token" \
  "http://127.0.0.1:3112/api/runs?status=running&repository=crs-src&role=development&task=TOK-1&limit=20"
```

验证 readiness：

```bash
curl -sS http://127.0.0.1:3112/api/readiness
```

使用测试库运行 worker：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" \
WORKER_EXECUTION_ADAPTER="codex-cli" \
pnpm worker
```

Codex-first 运行口径默认使用 `WORKER_EXECUTION_ADAPTER=codex-cli`，也允许显式切到 `WORKER_EXECUTION_ADAPTER=codex-app-server` 验证 Symphony-style app-server adapter。预期 worker 能从 PostgreSQL 读到带 Plane URL 和 repo routing 的可派发任务，创建 Control Plane run，准备 workspace，执行 Codex，并把 Codex event stream 摘要写入 `run_events` 和任务级 Progress / Workpad。裸 worker 仍可用 `mock-openhands` 做本地 legacy mock lifecycle，但不能作为 completion/task-source 默认完成证据。

长运行 worker：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" \
WORKER_RUN_LOOP=true \
WORKER_LOOP_INTERVAL_MS=60000 \
WORKER_LEASE_TTL_MS=900000 \
WORKER_LEASE_RENEWAL_INTERVAL_MS=300000 \
pnpm worker
```

运行语义：

- `WORKER_RUN_LOOP=false`：执行一次 `runOnce` 后退出，适合 smoke。
- `WORKER_RUN_LOOP=true`：每隔 `WORKER_LOOP_INTERVAL_MS` 执行一轮 dispatch。
- adapter 执行期间，worker 会每隔 `WORKER_LEASE_RENEWAL_INTERVAL_MS` 写 heartbeat，并把 `runs.lease_expires_at` 刷新到 `now + WORKER_LEASE_TTL_MS`。
- 收到 `SIGINT` / `SIGTERM` 后不再进入下一轮；当前 `runOnce` 收口后退出。

如果 `TOK-1` 已被前序验证推进到人工状态，可先重置演示任务：

```bash
docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -v ON_ERROR_STOP=1 \
  -c "delete from runs; update tasks set state='Development', updated_at=now() where identifier='TOK-1';"
```

Worker claim 会写入：

- `runs.status = 'claimed'`
- `runs.lease_owner`
- `runs.lease_expires_at`
- `runs.heartbeat_at`
- `runs.started_at`
- `run_events.event_type = 'claimed'`

重复运行 worker 时，如果 active lease 未过期，预期不会再次 claim 同一任务，而是返回：

```text
task already has an active run lease
```

当前 mock lifecycle 会继续写入：

- `runs.status = 'running'`
- `run_events.event_type = 'running'`
- `run_events.event_type = 'heartbeat'`
- `workspaces.status = 'ready'`
- `run_events.event_type = 'workspace.ready'`
- adapter event stream 摘要。Codex-first 预期为 `codex.started` / `codex.agent_message` / `codex.exec_command` / `codex.completed` 等 `codex.*` 事件；legacy OpenHands mock/cloud 才会写入 `openhands.agent_message` / `openhands.tool_call` / `openhands.shell`
- `runs.status = 'succeeded'`
- `run_events.event_type = 'completed'`
- `tasks.state = <role 默认下一状态>`
- stalled run 检测会写入 `runs.status = 'stalled'` 和 `run_events.event_type = 'stalled'`
- retryable failed/stalled run 会在 `WORKER_RETRY_BACKOFF_MS` 窗口内暂停重新派发
- non-retryable failure 会把 task 标记为 `Blocked`
- `openhands-cloud` terminal status 映射：
  - `finished` / `completed` / `succeeded` -> `succeeded`
  - 等待确认/用户输入和 `stuck` / `blocked` / `paused` 类状态 -> non-retryable failed，并把 task 标记为 `Blocked`
  - sandbox `ERROR` / `MISSING` / `LOST` / `UNAVAILABLE` / `TERMINATED` 和 execution `error` / `failed` / `crashed` / `timeout` 类状态 -> retryable failed
  - `cancelled` / `aborted` / `stopped` -> non-retryable failed
- adapter throw、API error、timeout 会写入 `openhands.adapter_error`，并标记为 retryable failed
- worker 执行 adapter 前会生成 `prompt_releases`，写入 `prompt_release_components`，并更新 `runs.prompt_release_id`
- adapter 返回 conversation ref 时，worker 会写入 `conversation_refs`。Codex-first profile 使用 `provider=codex-cli` 或 `provider=codex-app-server` 的 ref 作为本地执行引用。
- adapter 返回 trace refs 时，worker 会写入 `trace_refs`，并更新 `runs.token_*` / `runs.cost_usd`。Langfuse trace refs 仅属于 optional/legacy 观测增强，不是默认完成条件。

验证单次 run timeline：

```bash
docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -v ON_ERROR_STOP=1 \
  -c "select re.event_type, re.message, re.payload, re.created_at
      from run_events re
      join runs r on r.id = re.run_id
      join tasks t on t.id = r.task_id
      where t.identifier = 'TOK-1'
      order by re.created_at asc;"
```

预期至少能看到：

```text
claimed
running
workspace.ready
heartbeat
codex.started
codex.agent_message
codex.exec_command
codex.completed
completed
```

注意：这里的 `codex.*` 是 Codex CLI JSONL / process output 的本地摘要，便于 Control Plane 页面展示执行轨迹，并同步高信号 agent message / command / file / error 到任务级 Progress / Workpad；写入本地摘要前会对常见 API key、token、secret、password、Bearer token 和 `sk-*` key 做最小脱敏。`openhands.*` 事件只属于 legacy/optional OpenHands adapter；完整 OpenHands event log 仍以 `conversation_refs.event_log_uri` 指向的 OpenHands 侧日志为事实源，不再是默认 completion/task-source 证据。

Workspace 策略：

- 默认 `WORKER_WORKSPACE_STRATEGY=auto`：如果 repository 配置了 `local_path`，worker 使用该路径，`workspaces.strategy = 'local-path'`；否则 worker 在 `WORKER_WORKSPACE_ROOT/<repo-slug>/<run-id>` 创建目录，`workspaces.strategy = 'ephemeral'`。
- 设置 `WORKER_WORKSPACE_STRATEGY=git-worktree` 且 repository 配置了 `local_path` 时，worker 会执行 `git worktree add -B agent/<run-prefix> <workspace-path> <default-branch>`，为每个 run 创建隔离工作区，`workspaces.strategy = 'git-worktree'`。
- 默认 `WORKER_WORKSPACE_ROOT=/tmp/agent-control-plane-workspaces`。

启用 Langfuse run-level tracing：

```bash
export LANGFUSE_ENABLED=true
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
export LANGFUSE_PUBLIC_KEY="<redacted>"
export LANGFUSE_SECRET_KEY="<redacted>"
# 可选：用于生成 run detail 中可点击的 Langfuse trace URL。
export LANGFUSE_PROJECT_ID="<langfuse-project-id>"
export LANGFUSE_TRACING_ENVIRONMENT="dev"
export LANGFUSE_RELEASE="local-smoke"
pnpm worker
```

启用条件：

- `LANGFUSE_ENABLED` 必须等于 `true`。
- `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 必须同时存在。
- `LANGFUSE_PROJECT_ID` 只影响 `trace_refs.ui_url`，不影响 trace 上报。

Langfuse trace ref 验证：

```bash
docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -tAc "select provider, trace_id, generation_id, ui_url from trace_refs where provider='langfuse' order by created_at desc limit 1;"
```

预期：

```text
langfuse|<trace-id>|<observation-id>|<optional-ui-url>
```

切换 OpenHands Cloud adapter：

```bash
export WORKER_EXECUTION_ADAPTER="openhands-cloud"
export OPENHANDS_API_KEY="<redacted>"
export OPENHANDS_BASE_URL="https://app.all-hands.dev"
# 可选：默认从 repository.git_url 推导 owner/repo；这里可强制覆盖。
export OPENHANDS_SELECTED_REPOSITORY="michaelx1993/crs-src"
export OPENHANDS_START_TIMEOUT_MS=300000
export OPENHANDS_EXECUTION_TIMEOUT_MS=3600000
export OPENHANDS_START_POLL_INTERVAL_MS=5000
export OPENHANDS_EXECUTION_POLL_INTERVAL_MS=30000
pnpm worker
```

`openhands-cloud` adapter 使用 OpenHands Cloud V1 API：

- `POST /api/v1/app-conversations`
- `GET /api/v1/app-conversations/start-tasks?ids=<start-task-id>`
- `GET /api/v1/app-conversations?ids=<conversation-id>`

该 adapter 属于 legacy/optional execution profile。第一版 Codex-first completion/cutover 不要求 OpenHands conversation evidence；只有显式选择 OpenHands profile 时，才把真实 conversation payload、UI URL 和 payload contract 作为验收项。

已验证状态推进：

```text
Development -> Code Review -> Human Review
```

2026-06-19 Codex-first 本地验证：

```text
Development -> Code Review
run.status = succeeded
run.result_summary = Codex CLI completed run. / fake Codex smoke summary
run_events = claimed/running/workspace.ready/heartbeat/codex.started/codex.agent_message/codex.exec_command/codex.completed/completed
conversation_refs.provider = codex-cli
task progress = Agent Status: Running / Agent Events / Agent Status: Completed
```

2026-06-19 stalled smoke：

```text
insert expired running run
WORKER_STALLED_AFTER_MS=1 pnpm worker
run.status = stalled
run.failure_reason = Run stalled: heartbeat or lease expired.
```

Operator run 查询：

```bash
curl -sS "http://127.0.0.1:3112/api/runs?status=stalled&limit=20"
```

Prompt release smoke：

```bash
docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -v ON_ERROR_STOP=1 \
  -c "delete from runs; delete from prompt_release_components; delete from prompt_releases; update tasks set state='Development', updated_at=now() where identifier='TOK-1';"

DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" \
WORKER_ID="prompt-release-smoke" \
WORKER_EXECUTION_ADAPTER="codex-cli" \
PLANE_WRITEBACK_ENABLED=false \
pnpm worker

docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -tAc "select runs.prompt_release_id is not null, prompt_releases.content_hash ~ '^[a-f0-9]{64}$', count(prompt_release_components.id) from runs join prompt_releases on prompt_releases.id = runs.prompt_release_id left join prompt_release_components on prompt_release_components.prompt_release_id = prompt_releases.id group by runs.id, prompt_releases.id order by runs.created_at desc limit 1;"
```

预期结果：

```text
t|t|3
```

Prompt release API：

```bash
curl -sS "http://127.0.0.1:3112/api/prompt-releases?limit=5"
```

Conversation ref 验证：

```bash
docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -tAc "select provider, conversation_id, event_log_uri from conversation_refs order by created_at desc limit 1;"
```

Codex-first 预期：

```text
codex-cli|codex-<run-id>|process://codex-cli/runs/<run-id>
```

Trace ref 验证：

```bash
docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -tAc "select trace_refs.provider, trace_refs.trace_id, runs.token_total, runs.cost_usd from trace_refs join runs on runs.id = trace_refs.run_id order by trace_refs.created_at desc limit 1;"
```

legacy mock/Langfuse profile 才要求 trace ref；Codex-first 默认不以 trace ref 作为完成条件。legacy mock adapter 预期：

```text
mock-langfuse|trace-<run-id>|<token_total>|0.000000
```

Run detail API：

```bash
curl -sS "http://127.0.0.1:3112/api/runs/<run-id>"
```

Run list 页面：

```bash
open "http://127.0.0.1:3112/runs?status=running&repository=crs-src&role=development&task=TOK-1"
```

Run detail 页面：

```bash
open "http://127.0.0.1:3112/runs/<run-id>"
```

Prompt release detail API：

```bash
curl -sS "http://127.0.0.1:3112/api/prompt-releases/<release-id>"
```

Prompt release detail 页面：

```bash
open "http://127.0.0.1:3112/prompt-releases/<release-id>"
```

Prompt Manager API：

```bash
curl -sS "http://127.0.0.1:3112/api/prompt-components?status=active&limit=20"

curl -sS "http://127.0.0.1:3112/api/prompt-components/<component-id>"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"scope":"role","scopeId":"<role-id>","name":"Development","status":"draft","content":"新的开发角色 prompt","author":"operator","changelog":"local edit"}' \
  "http://127.0.0.1:3112/api/prompt-components"

curl -sS \
  -X POST \
  "http://127.0.0.1:3112/api/prompt-components/<component-id>/activate"

curl -sS \
  -X POST \
  "http://127.0.0.1:3112/api/prompt-components/<component-id>/archive"

curl -sS "http://127.0.0.1:3112/api/prompt-components/diff?from=<old-component-id>&to=<new-component-id>"

curl -sS "http://127.0.0.1:3112/api/prompt-components/<component-id>/metrics"
```

激活验证：

```bash
docker exec agent-control-plane-postgres psql \
  -U agent \
  -d agent_control_plane_migration_test \
  -tAc "select status from prompt_components where id='<component-id>'; select action from audit_events where entity_id='<component-id>' order by created_at desc limit 1;"
```

预期：

```text
active
prompt_component.activate
```

Prompt Manager 页面：

```bash
open "http://127.0.0.1:3112/prompt-components"
open "http://127.0.0.1:3112/prompt-components/<component-id>"
```

Project Settings API：

```bash
curl -sS "http://127.0.0.1:3112/api/settings"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"slug":"crs-src","gitUrl":"git@github.com:michaelx1993/crs-src.git","defaultBranch":"main","localPath":"","status":"active","description":"CRS backend/source repository."}' \
  "http://127.0.0.1:3112/api/settings/repositories/<repository-id>"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"projectId":"<project-id>","slug":"new-repo","gitUrl":"git@github.com:michaelx1993/new-repo.git","defaultBranch":"main","status":"active"}' \
  "http://127.0.0.1:3112/api/settings/repositories"

curl -sS \
  -X POST \
  "http://127.0.0.1:3112/api/settings/repositories/<repository-id>/archive"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"name":"Development Agent","activeStates":["Development"],"nextStates":["Code Review","Blocked","Done","Canceled"],"status":"active","description":"Implements or reworks the task."}' \
  "http://127.0.0.1:3112/api/settings/roles/<role-id>"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"key":"qa","name":"QA Agent","activeStates":"Code Review","nextStates":"Human Review","status":"active"}' \
  "http://127.0.0.1:3112/api/settings/roles"

curl -sS \
  -X POST \
  "http://127.0.0.1:3112/api/settings/roles/<role-id>/archive"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"name":"Development Agent","runtime":"openhands","model":"gpt-5.5","reasoningEffort":"high","toolProfile":"default","maxTurns":80,"timeoutSeconds":7200,"status":"active"}' \
  "http://127.0.0.1:3112/api/settings/agent-definitions/<agent-definition-id>"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"roleId":"<role-id>","name":"QA Agent","runtime":"openhands","model":"gpt-5.5","reasoningEffort":"high","toolProfile":"default","maxTurns":80,"timeoutSeconds":7200,"status":"active"}' \
  "http://127.0.0.1:3112/api/settings/agent-definitions"

curl -sS \
  -X POST \
  "http://127.0.0.1:3112/api/settings/agent-definitions/<agent-definition-id>/archive"
```

Prompt Binding API：

```bash
export ACP_OPERATOR_USER_ID="00000000-0000-4000-8000-000000000901"
export ACP_OPERATOR_NAME="local-operator"
export ACP_OPERATOR_ROLES="owner,prompt_admin,prompt_editor"

curl -sS "http://127.0.0.1:3112/api/prompt-bindings"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"scope":"team","scopeId":"<team-id>","promptComponentId":"<component-id>","orderIndex":10,"environment":"dev"}' \
  "http://127.0.0.1:3112/api/prompt-bindings"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"status":"active"}' \
  "http://127.0.0.1:3112/api/prompt-bindings/<binding-id>/status"

curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"status":"rejected"}' \
  "http://127.0.0.1:3112/api/prompt-bindings/<binding-id>/status"
```

Project Settings 页面：

```bash
open "http://127.0.0.1:3112/settings"
```

当前页面能力：

- 查看 team、project、repository、role、agent definition。
- 新增、编辑、归档 repository。
- 新增、编辑、归档 role。
- 新增、编辑、归档 agent definition。
- 创建、批准、拒绝、禁用、重新提交 prompt binding。
- 按 `ACP_OPERATOR_ROLES` 做最小权限门禁：创建需要 `prompt_editor` 以上，审批/拒绝/禁用/重新提交需要 `prompt_admin` 以上。
- 展示最近 Prompt Binding 审计事件。

用户管理：

```bash
open "http://127.0.0.1:3112/users"

curl -sS \
  -X POST \
  -H "authorization: Bearer <operator-token>" \
  -H "content-type: application/json" \
  -d '{"externalProvider":"local","externalUserId":"reviewer","name":"reviewer","email":"reviewer@example.com"}' \
  "http://127.0.0.1:3112/api/users"
```

`/users` 和 `POST /api/users` 需要 owner/admin；写入会 upsert `users`，并记录 `audit_events(action=user.upsert)`。

高级审计视图：

```bash
open "http://127.0.0.1:3112/audit"

curl -sS \
  -H "authorization: Bearer <operator-token>" \
  "http://127.0.0.1:3112/api/audit-events?action=prompt_binding.approve&limit=20"
```

当前 `/audit` 和 `GET /api/audit-events` 支持按 entity type、action、actor、createdAfter、createdBefore 和 limit 筛选，并展示/返回 action、entity type、actor 聚合摘要。

Rework API：

```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"body":"修复 review 指出的问题","source":"human","severity":"major","runId":"<run-id>"}' \
  "http://127.0.0.1:3112/api/tasks/<task-id>/rework"
```

预期效果：

- 当前 task state 必须允许转到 `Development`，例如 `Code Review` 或 `Human Review`。
- API 写入 `feedback_items`。
- API 将 `tasks.state` 更新为 `Development`。
- 下一次 worker 领取 Development run 时，prompt release 会包含 unresolved feedback。

Task Queue API：

```bash
curl -sS "http://127.0.0.1:3112/api/tasks?mode=human&limit=20"
curl -sS "http://127.0.0.1:3112/api/tasks?lease=active&retry=waiting&limit=20"
```

Task Queue 会返回并展示：

- `latestRun.attempt`
- `latestRun.leaseOwner`
- `latestRun.leaseExpiresAt`
- `latestRun.heartbeatAt`
- `latestRun.retryable`
- `latestRun.retryAfterAt`
- `activeRun` 的 lease/heartbeat 摘要
- `lease=active|none|expired` 和 `retry=retryable|waiting|ready|blocked` 深度筛选

Task Queue 页面：

```bash
open "http://127.0.0.1:3112/tasks?mode=human"
open "http://127.0.0.1:3112/tasks?lease=expired&retry=ready"
```

Task Queue / detail 会展示：

- active/latest run status、attempt、lease owner、lease expiry、heartbeat
- failed/stalled run 的 retryable/non-retryable 和 retry-after
- Task Detail 中最近 runs 的 started/finished/heartbeat/lease 时间线

Task detail API：

```bash
curl -sS "http://127.0.0.1:3112/api/tasks/<task-id>"
```

Task detail 页面：

```bash
open "http://127.0.0.1:3112/tasks/<task-id>"
```

Human gate 状态转移 API：

```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"targetState":"In Merge","actor":"operator","reason":"human approved"}' \
  "http://127.0.0.1:3112/api/tasks/<task-id>/transition"
```

预期效果：

- API 按 `packages/core` 状态机校验当前状态和目标状态。
- 成功时更新 `tasks.state`。
- 成功时写入 `audit_events(action=task.transition)`。
- `PLANE_WRITEBACK_ENABLED=true` 时，API 会尝试同步 Plane state/comment，并在响应中返回 `planeWriteback`。
- `pnpm plane:human-gate-writeback-smoke` 可验证 `transition` API 会触发 Plane writeback helper，并覆盖失败更新时不写 Plane。
- `pnpm plane:writeback-smoke` 可独立验证 Plane writeback：默认只读取 project states；设置 `PLANE_WRITEBACK_SMOKE_VERIFY_COMMENTS=true` 和 `PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID` 可只读验证 comments list API；设置 `PLANE_WRITEBACK_SMOKE_APPLY=true` 和 `PLANE_WRITEBACK_SMOKE_WORK_ITEM_ID` 后才 PATCH 指定 work item state 并 POST smoke comment。

Human gate 打回 API：

```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"body":"修复 reviewer 指出的问题后再提交。","source":"human","severity":"major"}' \
  "http://127.0.0.1:3112/api/tasks/<task-id>/rework"
```

预期效果：

- 成功时更新 `tasks.state = 'Development'`。
- 成功时写入 `feedback_items`，下一次 Development prompt release 会注入该反馈。
- `PLANE_WRITEBACK_ENABLED=true` 时，API 会把 Plane work item 移回 `Development` 并写入打回原因 comment。
- `pnpm plane:human-gate-writeback-smoke` 可验证 `rework` 和 `feedback(requestRework=true)` 会触发 Plane writeback helper，且普通 feedback-only comment 不写 Plane。

PR review feedback 摄取 API：

```bash
curl -sS \
  -X POST \
  -H "content-type: application/json" \
  -d '{"body":"PR review: add regression coverage.","source":"pr_review","severity":"major","externalUrl":"https://github.example/review/comment-1"}' \
  "http://127.0.0.1:3112/api/tasks/<task-id>/feedback"
```

预期效果：

- 默认只写入 unresolved `feedback_items(source=pr_review)`，不改变 `tasks.state`。
- 相同 `source + body + externalUrl` 会去重。
- 设置 `"requestRework": true` 时复用 rework 流程打回 `Development`，并在 `PLANE_WRITEBACK_ENABLED=true` 时回写 Plane。
- 下一次 Development prompt release 会注入 unresolved PR review feedback。

Task progress / Workpad：

- Worker 会写入 `feedback_items(source=agent_progress, severity=info)`，记录 `Agent Status: Running / Completed / Failed`。
- `/tasks/<task-id>` 会在 Progress / Workpad 面板单独展示这些记录。
- `agent_progress` 不会混入 unresolved feedback，也不会注入下一次 Development prompt。
- `pnpm worker:workflow-smoke` 会校验每个自动 run 至少写入 Running 和 Completed 两条 `agent_progress`，用于防止 agent 接单/完成不可见的回归。
- `pnpm worker:budget-smoke` 会校验预算超限任务自动进入 `Blocked`，并写入 `Agent Status: Blocked.` 的 `agent_progress`，用于防止预算门禁变成无声跳过。

当前限制：

- `codex-cli` adapter 已有第一阶段 `codex exec --json`、本地 `pnpm codex:adapter-smoke` 和 DB-driven `pnpm worker:codex-smoke`；真实 Plane task + 真实 repo 的 Codex Development run 仍待验收。
- Codex event stream 摘要已可同步到本地 `run_events`，并可把高信号事件写入任务级 Progress / Workpad；真实 Codex 长任务的事件分类、截断策略、噪声过滤和失败/重试映射仍需用实际返回校准。
- 默认 completion/task-source 证据必须覆盖 Plane URL、repo routing、Control Plane run、`codex-cli` run events、Progress / Workpad。真实 task-source cutover 样本仍待在 Plane/Control Plane 上验收。
- `mock-openhands` 只模拟成功结果，不执行真实代码；它会写入 agent message / tool call / shell 三类事件用于本地 timeline 验证，但不能作为 Codex-first 完成证据。
- `openhands-cloud` adapter 已实现 V1 REST 调用；真实 OpenHands conversation/payload/UI URL 校准只属于 legacy/optional profile，不阻断第一版 Codex-first 完成。
- trace ref 表、mock trace 和 Langfuse SDK run-level instrumentation 已打通；真实 Langfuse credentials 下的端到端 trace smoke 只属于 optional/legacy profile。
- Langfuse UI URL 需要额外配置 `LANGFUSE_PROJECT_ID`，路径格式为 `<LANGFUSE_BASE_URL>/project/<LANGFUSE_PROJECT_ID>/traces/<trace_id>`。
- 长运行 loop、lease 自动续租和本地 mock worker 崩溃恢复已有最小实现；真实 Codex 长任务进程崩溃、workspace 残留恢复和 `codex app-server` 长会话模式仍需实测。
- Task Queue / Human Gate 已有最小 UI；人工 gate/rework API 已具备 Plane 回写骨架和 API 级 writeback contract smoke，真实 Plane 状态/comment 同步 smoke 尚未复测。

## Docker Compose

本地启动 PostgreSQL、迁移、Web：

```bash
cp .env.example .env
docker compose up --build postgres migrate web
open "http://127.0.0.1:3112"
```

PostgreSQL 18 Docker image expects the persistent mount at `/var/lib/postgresql`
instead of the old `/var/lib/postgresql/data` mount point. The compose file uses
that parent directory so a fresh local volume can initialize without the
`pg_ctlcluster` compatibility error.

启动 Worker：

```bash
docker compose --profile worker up --build worker
```

默认策略：

- `web` 依赖 `migrate` 成功完成。
- `worker` 放在 `worker` profile，默认不随 `docker compose up` 抢任务。
- Codex-first completion/cutover profile 默认使用 `WORKER_EXECUTION_ADAPTER=codex-cli`，也接受显式 `WORKER_EXECUTION_ADAPTER=codex-app-server`；两者都依赖 Plane URL、repo routing、Control Plane run、`run_events`、Progress / Workpad 作为默认证据。`WORKER_CODEX_COMMAND`、`WORKER_CODEX_MODEL`、`WORKER_CODEX_REASONING_EFFORT`、`WORKER_CODEX_ARGS_JSON`、`WORKER_CODEX_APP_SERVER_COMMAND` 和 `WORKER_CODEX_APP_SERVER_ARGS_JSON` 可按环境覆盖。
- `mock-openhands` 仅用于本地 legacy mock lifecycle；`openhands-cloud` 需显式设置 `WORKER_EXECUTION_ADAPTER=openhands-cloud` 和 `OPENHANDS_API_KEY`，只属于 legacy/optional profile。
- `worker` 默认 workspace root 为 `/tmp/agent-control-plane-workspaces`，可用 `WORKER_WORKSPACE_ROOT` 覆盖；默认 `WORKER_WORKSPACE_STRATEGY=auto`，可设置为 `git-worktree` 为每个 run 创建隔离 worktree。
- `pnpm workspace:cleanup` 只清理已完成 run 的过期 `ephemeral` / `git-worktree` workspace，且路径必须位于 `WORKER_WORKSPACE_ROOT` 内；repository `local_path` 不会被清理。`git-worktree` 会优先走 `git worktree remove --force` 和 `git worktree prune` 清理主仓库 metadata，失败时 fallback 到目录删除。
- Plane 回写默认关闭，真实回写需设置 `PLANE_WRITEBACK_ENABLED=true` 以及 Plane API 环境变量。
- 首页 `运行监控` 告警阈值优先读取 `app_settings` 中的 `monitoring.*` 配置；缺省值可用 `MONITORING_QUEUE_BACKLOG_WARNING`、`MONITORING_STALLED_RUNS_CRITICAL`、`MONITORING_RETRY_BACKLOG_WARNING`、`MONITORING_FAILURE_RATE_CRITICAL`、`MONITORING_FAILURE_RATE_MIN_FINISHED`、`MONITORING_COST_WARNING_USD`、`MONITORING_RETRY_BACKOFF_MS` 覆盖；`MONITORING_RETRY_BACKOFF_MS` 未设置时回退到 `WORKER_RETRY_BACKOFF_MS`。
- `/settings` 的 Monitoring Thresholds 表单和 `PUT /api/monitoring/thresholds` 会写入 `app_settings`，并记录 `audit_events(action=monitoring_thresholds.update)`。
- `/settings` 的 Dispatch Policy 表单和 `PUT /api/dispatch/policy` 会写入 `app_settings(dispatch.max_estimated_cost_usd_per_run)`；worker 派发时优先读取 DB 持久化配置，未配置时回退 `WORKER_MAX_ESTIMATED_COST_USD_PER_RUN`。超过预算的自动任务不会被 claim，会进入 `Blocked` 并写入任务级 Progress / Workpad。
- `pnpm plane:sync` 会按 `PLANE_SYNC_RETRY_ATTEMPTS` / `PLANE_SYNC_RETRY_DELAY_MS` 重试 Plane polling API；在无 `commentFetchWarnings` 的成功同步后写入 `app_settings(plane.sync_cursor.<projectSlug>)`；下一轮 polling 会过滤 cursor 之前未变化的 task/comment，作为 webhook 不完整时的增量 fallback。若单个 work item comment 拉取失败，本轮会继续同步其他 task/comment，但不推进 cursor；配置 `MONITORING_ALERT_WEBHOOK_URL` 后会发送 Plane sync warning webhook。全局 sync failure 会发送 Plane sync critical webhook 并退出非 0。
- worker 配置 `MONITORING_ALERT_WEBHOOK_URL` 后会发送 active alerts；`MONITORING_ALERT_MIN_INTERVAL_MS` 控制同一 alert fingerprint 的最小发送间隔；`MONITORING_ALERT_FORMAT=slack` 时发送 Slack Block Kit payload，`MONITORING_ALERT_FORMAT=email` 时发送 subject/text/html 邮件 payload，否则发送通用 JSON payload。
- 部署前可执行 `ACP_ENV=production pnpm secrets:validate`；`deploy:compose` 会自动运行 `scripts/validate-secrets.sh`，在严格模式下阻断缺失或明显弱 secret。

生产化发布、部署和应用镜像回滚见：

```text
docs/agent-control-plane-production-runbook.md
```

根级脚本：

```bash
pnpm release:image
pnpm deploy:compose
pnpm rollback:compose
pnpm db:backup
pnpm db:restore
```

## CI Release Gate

GitHub Actions workflow：

```text
.github/workflows/ci.yml
```

门禁内容：

- Node 24 + pnpm 11 安装依赖。
- PostgreSQL service 启动。
- `pnpm db:migrate && pnpm db:seed` 验证迁移和 seed。
- `pnpm format`
- `pnpm check`
- `pnpm build`
