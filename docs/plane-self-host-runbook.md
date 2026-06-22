# Plane Self-host Runbook

## 目标

本文是 Agent Control Plane P0.5 的 Plane self-host 操作手册。目标不是立刻生产化，而是验证：

- Plane 能在自控环境启动并登录。
- Plane API 能读取 project、work item、state、comment，并确认 repo 字段承载方案。
- Plane webhook 能覆盖 work item / comment / project 变更。
- repo 字段能先用 custom property 承载，失败时用 `repo:<slug>` label 兜底。

官方资料：

- Developer docs: https://developers.plane.so/
- Docker Compose: https://developers.plane.so/self-hosting/methods/docker-compose
- API introduction: https://developers.plane.so/api-reference/introduction
- Webhooks: https://developers.plane.so/dev-tools/intro-webhooks

## 当前结论

截至 2026-06-22：

- GitHub fork 已存在：`https://github.com/michaelx1993/plane`
- 本机 Plane self-host 已启动：`http://127.0.0.1:3200`；MBP 部署入口使用公网 IP。
- Plane release：`v1.3.1`
- 生产化发布已切到 `michaelx1993/plane` 自有 fork，通过 GitHub hosted CI 发布 DockerHub 镜像：`michaelxxx/plane-frontend:0.0.1`、`michaelxxx/plane-backend:0.0.1`、`michaelxxx/plane-admin:0.0.1`、`michaelxxx/plane-space:0.0.1`、`michaelxxx/plane-live:0.0.1`、`michaelxxx/plane-proxy:0.0.1`。
- MBP 运行态应用层不再使用 `makeplane/*` 官方应用镜像；PostgreSQL、Valkey、RabbitMQ、MinIO 作为基础设施继续使用社区镜像。
- PR #5 `Add bilingual top navigation language switcher` 已合入 `preview`：右上角提供 English / 简体中文切换入口，并移除右上角 GitHub 跳转链接。
- 当前双语能力是导航入口和 Plane 既有 i18n 语言切换集成，不代表所有业务文案已经完整人工汉化；后续新增中文词条应继续走 `packages/i18n` 同步检查。
- P0.5 API smoke test 已通过。
- P0.5 webhook smoke test 已通过。
- Plane v1.3.1 Community self-host 未暴露官方文档里的 work item custom property API。
- 第一版 repo 字段方案：work item label `repo:<slug>`。
- Control Plane 已提供 `pnpm plane:sync`，可把 Plane work items 同步到本地 `tasks`。
- PAT 存放在仓库外：`~/plane-selfhost/agent-control-plane.env`

## 推荐本机端口

避免和当前服务冲突：

| 服务                | 端口  |
| ------------------- | ----- |
| Agent Control Plane | 3112  |
| Control Plane DB    | 54329 |
| Plane HTTP          | 3200  |
| Plane HTTPS         | 3443  |

## Community Edition 安装

官方 Docker Compose 社区版流程会下载 `setup.sh` 并生成 `plane-app` 目录。

```bash
mkdir -p ~/plane-selfhost
cd ~/plane-selfhost
curl -fsSL -o setup.sh https://github.com/makeplane/plane/releases/latest/download/setup.sh
chmod +x setup.sh
./setup.sh
```

第一次菜单选择：

```text
1) Install
```

安装完成后退出，编辑生成的 env 文件。常用关键项：

```bash
LISTEN_HTTP_PORT=3200
LISTEN_HTTPS_PORT=3443
WEB_URL=http://127.0.0.1:3200
CORS_ALLOWED_ORIGINS=http://127.0.0.1:3200,http://127.0.0.1:3112
```

再次执行：

```bash
./setup.sh
```

菜单选择：

```text
2) Start
```

访问：

```text
http://127.0.0.1:3200
```

停止或重启：

```bash
./setup.sh
# 3) Stop
# 4) Restart
```

## Commercial Edition 安装备选

官方当前推荐商业版可用 Prime CLI：

```bash
curl -fsSL https://prime.plane.so/install/ | sh -
```

本项目 P0.5 默认先用 Community Edition 验证 API/webhook；商业版只在需要付费能力、God mode 或商业部署能力时启用。

## 初始化工作区

登录 Plane 后创建：

```text
workspace: aiworkspace
teamspace: token-team
project: token
```

创建项目状态，映射当前 workflow：

```text
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
Done
Canceled
```

Plane v1.3.1 Community self-host 当前不要依赖 repo custom property。以下 API 已实测返回 404：

```text
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-item-types/
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-item-properties/
GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-item-types/null/work-item-properties/
```

优先创建 labels：

```text
repo:crs-src
repo:sub3
repo:traffic
```

历史 custom property 设计保留为未来 Plane 二开目标：

```text
display_name: repo
property_type: OPTION
options:
  - crs-src
  - sub3
  - traffic
is_required: true
is_multi: false
external_source: agent-control-plane
external_id: repo
```

## API Key

Plane API 使用 `X-API-Key` header。创建路径：

```text
Profile Settings -> Personal Access Tokens -> Add personal access token
```

本地环境变量：

```bash
export PLANE_BASE_URL="http://127.0.0.1:3200"
export PLANE_WORKSPACE_SLUG="aiworkspace"
export PLANE_PROJECT_ID="<project-uuid>"
export PLANE_PROJECT_SLUG="token"
export PLANE_API_KEY="<redacted>"
export PLANE_WEBHOOK_SECRET="<redacted>"
```

不要把 `PLANE_API_KEY` 写入仓库。

本机 smoke 环境变量存放在仓库外：

```text
~/plane-selfhost/agent-control-plane.env
```

## Control Plane Sync

当前同步路径：

```text
Plane work items
-> Plane API client
-> label ID 映射为 label name
-> repo:<slug> 解析
-> PostgreSQL tasks upsert
```

执行：

```bash
set -a
source ~/plane-selfhost/agent-control-plane.env
set +a

DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" pnpm plane:sync
```

预期输出：

```json
{
  "fetched": 1,
  "upserted": 1,
  "routed": 1,
  "unrouted": 0
}
```

## Live API / Webhook Smoke

`plane:live-smoke` 是 P1 自部署 Plane 验收入口，覆盖：

- PAT / `X-API-Key` 能访问 Plane API。
- project states、labels、work items 可读取。
- `PLANE_LIVE_SMOKE_APPLY=true` 时创建临时 work item，更新 state，写入 comment，并回读验证。
- `PLANE_LIVE_SMOKE_VERIFY_WEBHOOK=true` 时向 Control Plane webhook receiver 发送签名 synthetic webhook，验证 HMAC 和 receiver 可达。
- 记录是否看到 `Retry-After` / `X-RateLimit-*` 响应头；没有头不会失败，但会在输出中标记 `rate_limit_headers_seen=false`。

先跑无副作用只读验证：

```bash
ACP_SECRET_ENV_FILE=~/plane-selfhost/agent-control-plane.env pnpm plane:live-smoke
```

跑真实 work item / state / comment 写入验证：

```bash
ACP_SECRET_ENV_FILE=~/plane-selfhost/agent-control-plane.env \
PLANE_LIVE_SMOKE_APPLY=true \
PLANE_LIVE_SMOKE_NEXT_STATE=Development \
pnpm plane:live-smoke
```

如果本地 Control Plane 已启动并配置 `PLANE_WEBHOOK_SECRET`，再验证 webhook receiver：

```bash
ACP_SECRET_ENV_FILE=~/plane-selfhost/agent-control-plane.env \
ACP_PLANE_WEBHOOK_URL=http://127.0.0.1:3112/api/plane/webhook \
PLANE_LIVE_SMOKE_VERIFY_WEBHOOK=true \
pnpm plane:live-smoke
```

脚本自测不依赖真实 Plane，会启动临时 fake Plane API 和 fake webhook receiver：

```bash
pnpm plane:live-smoke-self-test
```

注意：

- Plane work item API 返回的是 label ID，不是 label name。
- 同步前必须先拉取 project labels，建立 `label_id -> name` 映射。
- 没有 `repo:<slug>` label 的 task 会写入本地库，但不会进入可派发队列。

## API Smoke Test

获取项目列表：

```bash
curl -fsS \
  -H "X-API-Key: $PLANE_API_KEY" \
  "$PLANE_BASE_URL/api/v1/workspaces/$PLANE_WORKSPACE_SLUG/projects/"
```

获取项目 states：

```bash
curl -fsS \
  -H "X-API-Key: $PLANE_API_KEY" \
  "$PLANE_BASE_URL/api/v1/workspaces/$PLANE_WORKSPACE_SLUG/projects/$PLANE_PROJECT_ID/states/"
```

创建 work item：

```bash
curl -fsS -X POST \
  -H "X-API-Key: $PLANE_API_KEY" \
  -H "Content-Type: application/json" \
  "$PLANE_BASE_URL/api/v1/workspaces/$PLANE_WORKSPACE_SLUG/projects/$PLANE_PROJECT_ID/work-items/" \
  -d '{
    "name": "P0.5 smoke test",
    "description": "Agent Control Plane Plane API smoke test.",
    "priority": "medium"
  }'
```

列出 work items：

```bash
curl -fsS \
  -H "X-API-Key: $PLANE_API_KEY" \
  "$PLANE_BASE_URL/api/v1/workspaces/$PLANE_WORKSPACE_SLUG/projects/$PLANE_PROJECT_ID/work-items/?per_page=20"
```

更新 work item 状态：

```bash
export PLANE_WORK_ITEM_ID="<work-item-uuid>"
export PLANE_STATE_ID="<state-uuid>"

curl -fsS -X PATCH \
  -H "X-API-Key: $PLANE_API_KEY" \
  -H "Content-Type: application/json" \
  "$PLANE_BASE_URL/api/v1/workspaces/$PLANE_WORKSPACE_SLUG/projects/$PLANE_PROJECT_ID/work-items/$PLANE_WORK_ITEM_ID/" \
  -d "{\"state\":\"$PLANE_STATE_ID\"}"
```

添加 comment：

```bash
curl -fsS -X POST \
  -H "X-API-Key: $PLANE_API_KEY" \
  -H "Content-Type: application/json" \
  "$PLANE_BASE_URL/api/v1/workspaces/$PLANE_WORKSPACE_SLUG/projects/$PLANE_PROJECT_ID/work-items/$PLANE_WORK_ITEM_ID/comments/" \
  -d '{
    "comment_html": "<p>Agent Control Plane smoke comment.</p>",
    "external_source": "agent-control-plane",
    "external_id": "p0.5-smoke"
  }'
```

## Webhook Smoke Test

Plane webhook consumer 要求：

- endpoint 可被 Plane 访问，不能是 Plane 容器无法访问的 `localhost`。
- 对 POST 返回 HTTP 200。
- 验签使用 `X-Plane-Signature` 和 webhook secret 做 HMAC-SHA256。
- 事件 header 包含 `X-Plane-Delivery`、`X-Plane-Event`、`X-Plane-Signature`。

本机验证可先启动临时接收器：

```bash
pnpm dlx localtunnel --port 3112
```

或使用同类隧道，把公网 URL 配到 Plane webhook。

第一批要勾选的事件：

```text
Project
Issue
Issue Comment
```

验收动作：

1. 创建 work item，确认收到 `issue/create` 或等价 payload。
2. 更新 work item 状态，确认收到 `issue/update`。
3. 新增 comment，确认收到 `issue_comment/create`。
4. 删除测试 work item，确认收到 delete payload。

如果 webhook 不稳定，P1 必须保留 polling fallback。

当前 Control Plane receiver：

```text
POST /api/plane/webhook
```

行为：

- 使用 `PLANE_WEBHOOK_SECRET` 校验 `X-Plane-Signature` HMAC-SHA256。
- `issue*` 事件触发 Plane API 同步，将 work item upsert 到本地 `tasks`。
- `issue_comment*` 事件提取 issue id 和 comment body，写入本地 `feedback_items(source=plane_comment)`。

本机 smoke：

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" \
PLANE_WEBHOOK_SECRET="<local-smoke-secret>" \
pnpm --filter @agent-control-plane/web exec next start --hostname 127.0.0.1 --port 3114
```

验收结果：

```text
issue updated -> {"accepted":true,"eventName":"issue updated","synced":1}
issue_comment created -> {"accepted":true,"eventName":"issue_comment created","feedbackInserted":true}
feedback_items -> plane_comment|<p>Webhook feedback smoke</p>
```

## Worker Writeback Smoke Test

当前 worker 完成 run 后会：

```text
local run succeeded
-> local task advance next state
-> PATCH Plane work item state
-> POST Plane summary comment
```

执行：

```bash
set -a
source ~/plane-selfhost/agent-control-plane.env
set +a

DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane_migration_test" \
WORKER_ID="writeback-smoke" \
WORKER_EXECUTION_ADAPTER="mock-openhands" \
pnpm worker
```

验收结果：

```text
Plane work item: 791a6eb4-6536-458a-a5a5-5a2ba04483c8
state after worker completion: Human Review
```

注意：

- 只有带 Plane URL 的 mirrored task 会回写 Plane。
- 本地 seed/demo task 不会触发 Plane writeback，避免对不存在的 external id 发 PATCH。

## P0.5 验收清单

- [x] Plane self-host 可访问。
- [x] 创建 workspace/project。
- [x] 创建 workflow states。
- [x] 创建 `repo:<slug>` labels。
- [x] PAT 创建成功，API 使用 `X-API-Key` 认证通过。
- [x] `projects` API 可读。
- [x] `states` API 可读。
- [x] `work-items` API 可创建、读取、更新。
- [x] `comments` API 可创建。
- [x] webhook 可收到 issue update。
- [x] webhook 可收到 issue comment。
- [x] Control Plane webhook receiver 可验签并处理 issue/comment。
- [x] 明确 repo 字段当前方案：label 兜底；未来 fork Plane 二开一等字段。
- [x] 明确 MVP/P1 不因 Plane 二开阻塞；生产化 TODO 已要求纳入自有 Plane fork、部署链路和二开 backlog。

## 2026-06-19 本机验证记录

Plane self-host：

```text
URL: http://127.0.0.1:3200
release: v1.3.1
proxy: 0.0.0.0:3200->80/tcp, 0.0.0.0:3443->443/tcp
HTTP: 200 OK
```

创建的数据：

```text
workspace: aiworkspace
project: token
states: Todo, Development, Code Review, Human Review, In Merge, Merged,
        Release Version, Released, Deployment, Deployed, Done, Canceled
smoke work item: P0.5 smoke test
```

API smoke：

```text
GET projects: 200
GET states: 200
GET work-items: 200
POST comment: 201
```

Webhook smoke：

```text
receiver: http://host.docker.internal:3113/plane-webhook-smoke
WEBHOOK_ALLOWED_HOSTS=host.docker.internal
PATCH work item: 200
POST comment: 201
received events:
  issue updated, X-Plane-Signature present
  issue updated, X-Plane-Signature present
  issue_comment created, X-Plane-Signature present
```

说明：

- `host.docker.internal` 只用于本机 smoke test。
- 临时 webhook receiver 已停止。
- Plane 服务保持运行，便于 UI 检查。
- API token 不提交，存放在 `~/plane-selfhost/agent-control-plane.env`。

## 风险

- Plane API rate limit 当前官方文档写明同一 API key 每分钟 60 次，P1 polling 必须做节流。
- webhook endpoint 对本地 `localhost` 不友好，需要隧道或同 docker network endpoint。
- custom property API 在当前 Plane v1.3.1 Community self-host 不可用。
- repo 字段短期使用 label 兜底；后续 fork Plane 二开一等字段。
- 本次初始化用 Django ORM 创建 smoke 数据；P1 仍需要覆盖正常 UI/PAT 创建路径。
