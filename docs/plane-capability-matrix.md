# Plane Capability Matrix

## 资料来源

截至 2026-06-19，本文基于 Plane 官方 developer docs：

- https://developers.plane.so/
- https://developers.plane.so/self-hosting/methods/docker-compose
- https://developers.plane.so/api-reference/introduction
- https://developers.plane.so/dev-tools/intro-webhooks

本文记录 P0.5 设计判断和 2026-06-19 本机 smoke test 结果。

## Self-host

| 能力           | 官方状态 | 本地状态 | 结论                         |
| -------------- | -------- | -------- | ---------------------------- |
| Docker Compose | 支持     | 已通过   | P0.5 默认路径，v1.3.1        |
| Docker AIO     | 支持     | 未实测   | 只适合快速评估，不做默认路径 |
| Kubernetes     | 支持     | 未实测   | 生产化后再评估               |
| Prime CLI      | 支持     | 未实测   | 商业版备选                   |
| 本地 fork      | 已存在   | 已确认   | `michaelx1993/plane`         |

## API

Plane API 使用 REST，PAT 通过 `X-API-Key` header 认证。self-host base URL 取决于部署域名。

| Control Plane 需求       | Plane API 能力       | Endpoint 形态                                                                                                    | 状态       | 备注                                                                                                |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| 拉取 project             | List Projects        | `GET /api/v1/workspaces/{workspace_slug}/projects/`                                                              | 已通过     | P1 team/project sync 必需                                                                           |
| 拉取 work items          | List Work Items      | `GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/`                                      | 已通过     | 返回 `labels` 为 label ID                                                                           |
| 创建 work item           | Create Work Item     | `POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/`                                     | 间接通过   | ORM 创建，API 读取通过                                                                              |
| 更新 work item           | Update Work Item     | `PATCH /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{resource_id}/`                      | 已通过     | worker 状态回写已验证                                                                               |
| 拉取 states              | List States          | `GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/states/`                                          | 已通过     | workflow mapping 必需                                                                               |
| 拉取 labels              | List Project Labels  | `GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/labels/`                                          | 已通过     | repo label 解析必需                                                                                 |
| 创建 label               | Create Project Label | `POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/labels/`                                         | 已通过     | 已创建 `repo:crs-src`                                                                               |
| 更新 work item labels    | Update Work Item     | `PATCH /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{resource_id}/`                      | 已通过     | `labels` 接受 label ID array                                                                        |
| 创建 comment             | Add Comment          | `POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{work_item_id}/comments/`             | 已通过     | worker summary 回写已验证                                                                           |
| 拉取 comments            | List Comments        | 同 work item comments API family                                                                                 | smoke 覆盖 | `plane:writeback-smoke` 可只读验证 comments list；`plane:live-smoke` 可创建并回读验证真实 test item |
| 创建 custom property     | Add Property         | `POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-item-types/{type_id}/work-item-properties/` | 不可用     | v1.3.1 Community 返回 404                                                                           |
| 写 custom property value | Add Property Values  | work item type values API family                                                                                 | 不可用     | 当前版本不作为 P1 依赖                                                                              |

## Webhook

| 需求                           | Plane webhook 能力   | 状态   | 结论                            |
| ------------------------------ | -------------------- | ------ | ------------------------------- |
| project create/update/delete   | Project              | 待实测 | 可用于 project sync             |
| work item create/update/delete | Issue                | 已通过 | 已收到 issue update             |
| comment create/update/delete   | Issue Comment        | 已通过 | 已收到 issue_comment create     |
| state change                   | Issue update payload | 已通过 | state PATCH 触发 issue update   |
| retry                          | 失败后重试           | 待实测 | 官方说明有指数退避              |
| signature                      | HMAC-SHA256          | 已通过 | `/api/plane/webhook` 已实现验签 |

Webhook headers:

```text
X-Plane-Delivery
X-Plane-Event
X-Plane-Signature
```

## Repo 字段方案

当前推荐顺序：

1. Plane label `repo:<slug>`
2. fork Plane 增加一等 repo 字段
3. Plane custom property `repo`，仅在后续版本或二开验证可用后恢复

当前判断：

- Plane v1.3.1 Community self-host 不暴露 documented work item type / custom property endpoints。
- 数据库内未发现可直接使用的 custom property 表。
- Work item API 返回 label ID，必须先拉 project labels 再映射为 label name。
- `repo:<slug>` label 已在本机 API 中完成创建、绑定、读取验证。
- P1 同步代码已按 label fallback 实现，后续 Plane 二开再升级为一等字段。

## Rate Limit

官方 API 文档当前写明：

```text
60 requests / minute / API key
```

P1 策略：

- webhook 优先。
- polling fallback 默认 60s。
- polling 每轮只拉必要 workspace/project。
- 使用 cursor pagination。
- Plane client 会在 API error 中暴露 `status`、响应 body 和 `retryAfterMs`，其中 `retryAfterMs` 会从 `Retry-After` 或 `X-RateLimit-Reset` 推导。
- polling sync retry 默认 3 次、基础延迟 1000ms，会优先使用 `retryAfterMs` 退避；429/5xx/408 和网络类失败可重试，401/403/404 等非重试型 4xx 快速失败。
- `pnpm plane:live-smoke` 会记录是否看到 `Retry-After` / `X-RateLimit-*` 响应头；Plane 当前若不返回这些头，脚本不会失败，但 cutover evidence 必须记录该事实。

## P1 接入前必须回答

- self-host base URL 是否固定为 `http://127.0.0.1:3200`，还是服务器域名。
- webhook secret 从 UI 导出的 CSV 如何保存到本地 secret store。
