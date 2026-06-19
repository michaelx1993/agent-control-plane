# P0.5 Plane Self-host Spike

本文记录 P0.5 对 Plane self-host、API、webhook、repo 字段和 fork 路线的验证目标。当前结论基于 2026-06-19 查阅的官方 developer docs、API docs 和 fork 仓库信息；运行时行为仍以 self-host 实测为准。

## 信息源

- Plane developer docs: https://developers.plane.so/
- Plane API introduction: https://developers.plane.so/api-reference/introduction
- Work items API: https://developers.plane.so/api-reference/issue/list-issues
- Webhooks: https://developers.plane.so/dev-tools/intro-webhooks
- Self-host Docker Compose: https://developers.plane.so/self-hosting/methods/docker-compose
- Fork: https://github.com/michaelx1993/plane
- Upstream: https://github.com/makeplane/plane

## Self-host 验证目标

目标不是生产部署，而是在进入 P1 前证明 Plane 能作为人类任务面板稳定接入 Control Plane。

1. 使用 Plane self-host Community Edition 启动一套实例，完成登录、workspace、project、work item 创建。
2. 生成 Personal Access Token，确认 self-host API base URL 使用本实例域名，鉴权 header 为 `X-API-Key`。
3. 验证 work item 读写、状态更新、评论写入、label 读取、custom property 读写。
4. 验证 webhook receiver 可收到 project、issue、issue comment 事件，并校验 `X-Plane-Signature`。
5. 验证 webhook 对本地 receiver 的可达性要求。官方要求 webhook endpoint 是 publicly accessible non-localhost URL，因此本地开发需 tunnel 或临时公网 receiver。
6. 验证 60 req/min API rate limit 对 polling fallback 的影响，并记录 `X-RateLimit-Remaining`、`X-RateLimit-Reset`。

## Fork 策略

- 上游仓库：`makeplane/plane`，默认分支已确认为 `preview`，license 为 AGPLv3。
- 团队 fork：`michaelx1993/plane`，默认分支已确认为 `preview`，作为后续 self-host patch 与字段二开的工作入口。
- 短期策略：P0.5 不改 Plane 源码，先用官方 API/custom property/label 验证接入闭环。
- 中期策略：如果 repo 字段、work item 页面展示或 webhook payload 无法满足 P1，才在 fork 上做最小二开。
- 分支策略：从 fork 的 `preview` 拉短分支，例如 `p0.5-repo-field-spike`；上游同步以 `makeplane/plane:preview` 为基线，二开 diff 保持可审计。
- AGPL 注意：任何服务端二开都按 AGPLv3 约束处理，后续生产 self-host 需要保留源码披露与 license 合规检查。

## API/Webhook Capability Matrix

| 能力               | 官方能力                                                                                             | P0.5 验证方式                                               | P1 判定                             |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| API 鉴权           | API key header `X-API-Key`；OAuth bearer token 也可用                                                | self-host 生成 token 后调用 current user/project/work item  | API key 足够进入 P1                 |
| Rate limit         | 60 req/min per API key，响应头暴露 remaining/reset                                                   | 连续请求确认 429 行为和 header                              | polling 必须限速并分页              |
| List work items    | `GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/`                          | 拉取 project work items，记录分页、字段、expand             | Control Plane task sync 的主入口    |
| Update work item   | `PATCH /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{resource_id}/`          | 更新 `state`、`priority`、`labels`、摘要字段                | run 完成后可回写状态                |
| Work item comments | `POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/{work_item_id}/comments/` | 写入 run 摘要 comment                                       | 只写低频结果，不写 heartbeat/log    |
| Labels             | Work item update 支持 `labels`，Project Labels 有 CRUD                                               | 创建并读取 `repo:<name>` label                              | 仅作 repo 字段兜底                  |
| Custom properties  | 有 properties、values、options API                                                                   | 创建 `repo` property 并对 work item 写入/读取 value         | 优先作为 repo 字段方案              |
| Webhook events     | 官方列出 Project、Issue、Cycle、Module、Issue Comment                                                | 配 receiver，触发 create/update/delete/comment/state change | 覆盖不足则 P1 保留 polling fallback |
| Webhook signature  | `X-Plane-Signature` 基于 secret 和 payload HMAC-SHA256                                               | receiver 使用 constant-time compare 校验                    | receiver 必须拒绝签名失败请求       |
| Webhook delivery   | POST JSON，失败会重试数次并 exponential backoff                                                      | 让 receiver 返回非 200 观察重试                             | 不把 webhook 当唯一事实源           |

## Work-items API 路径示例

```bash
curl -X GET \
  "$PLANE_BASE_URL/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/" \
  -H "X-API-Key: $PLANE_API_KEY"
```

Control Plane uses `PLANE_API_KEY_HEADER=X-API-Key` by default. Do not switch to bearer auth unless
the target Plane deployment explicitly requires OAuth-compatible `Authorization` headers.

最小读取字段建议：

- `id`
- `sequence_id`
- `name`
- `state`
- `labels`
- `priority`
- `updated_at`
- `external_id`
- `external_source`

分页策略：

- `per_page` 最大按官方文档为 `100`。
- P1 polling fallback 以 `updated_at` cursor 或 Plane cursor 分页为准，单 token 不超过 60 req/min。
- webhook 成功时仍保留周期性 reconciliation，避免漏事件。

## Repo 字段方案

优先级：

1. Plane custom property：创建 `repo` 字段，类型优先 text 或 dropdown。Control Plane 读取 custom property value 后映射到本地 `repositories.name` 或 `repositories.slug`。
2. Plane 二开字段：如果 custom property 在列表页、API filter、webhook payload 或权限模型上不足，在 fork 中为 work item 增加一等字段，例如 `repository_key`。
3. Label 兜底：使用 `repo:<name>` label，例如 `repo:crs-src`。只用于 P0.5/P1 fallback，不作为长期正式模型。

判定标准：

- 能 API 读取。
- 能 UI 创建和修改。
- 能被 webhook payload 或后续 API reconciliation 捕获。
- task 无 repo 时仍能同步入库，但不能进入可派发队列。

## P0.5 验收 Checklist

- [x] self-host Plane 可启动并完成登录。2026-06-19 本机 `http://127.0.0.1:3200` 返回 200。
- [x] 已创建 spike workspace、project、work item。实测 workspace `aiworkspace`，project `token`。
- [x] 已生成 API key，确认 self-host API base URL 可用。API key 已脱敏，仅用于本机 probe。
- [x] `GET /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/` 可拉取 work items。
      使用 `pnpm plane:probe` 的 non-mutating 模式记录结果。
- [x] `PATCH` work item 可更新状态和 labels。2026-06-19 用 `PLANE_PROBE_MUTATE=true`
      对 disposable `P0.5 smoke test` 实测通过；PATCH 使用现有 state ID 和 label ID，避免改变业务状态。
- [x] comment API 可写入 run 摘要。2026-06-19 用 `PLANE_PROBE_COMMENT_BODY` 对 disposable
      `P0.5 smoke test` 实测通过。
- [ ] API rate limit 60 req/min 已在 self-host 实例实测或确认行为一致。
- [x] custom property `repo` 已实测。2026-06-19 对 disposable `P0.5 smoke test` PATCH
      `custom_fields.repo=crs-src`：API 不报错，但 PATCH/GET 均不回显，DB `issues` 表也无
      custom field 存储列；P1 不依赖该能力，repo routing 继续使用 `repo:<name>` label fallback。
- [x] `repo:<name>` label fallback 可创建、读取、解析。Plane 返回 work-item label ID 时，
      Control Plane 会先读 project labels API，再把 label ID 解析为 `repo:<name>`；2026-06-19
      probe 已解析出 `repo=crs-src`。
- [ ] webhook receiver 能收到 issue create/update/delete。
- [ ] webhook receiver 能收到 issue comment。
- [ ] state change 是否表现为 issue update 已实测并记录。
- [x] receiver 校验 `X-Plane-Signature`。代码已支持 HMAC-SHA256 raw body 验签；仍需 self-host
      webhook delivery 实测。
- [x] webhook 不完整时的 polling fallback 决策已记录。worker 已实现 60s 最小间隔、
      `updated_since` cursor 和 `per_page<=100`；仍需 self-host API 行为实测。
- [x] fork `michaelx1993/plane` 的同步、分支、license 策略已确认。GitHub 显示它是
      `makeplane/plane` fork，默认分支为 `preview`。
- [x] 明确 P1 是否需要 Plane 源码二开：P1 暂不二开，依赖 API + polling fallback +
      `repo:<name>` label；正式 repo 字段、页面展示或 webhook 粒度不足时再进入 Plane fork。

## 风险和未验证项

- 官方 docs 仍沿用 `issue` 命名，而产品术语为 work item；API path 使用 `/work-items/`，webhook event 仍可能是 `issue`。P0.5 receiver 需兼容该命名差异。
- webhook 事件粒度需实测：state change 可能只表现为 issue update，payload 是否包含足够 diff 未验证。
- webhook 要求公网可访问，纯 localhost receiver 不能直接接收 Plane 推送。
- custom property `repo` PATCH/GET 已实测不足以作为 P1 repo routing 字段；P1 使用 label fallback，
  后续若需要页面展示、filter/order 或强类型字段，再进入 Plane fork 二开字段。
- self-host Community Edition 与 Plane Cloud API 行为可能存在差异，尤其是 custom property、webhook、rate limit。
- 60 req/min 对多 project polling 偏紧，P1 必须做分页、退避、reconciliation 窗口和 token 预算。
- AGPLv3 对服务端二开有合规约束，生产化前要补 license checklist。
- 目前未执行真实 self-host 部署、API 调用和 webhook receiver 测试；本文是 P0.5 执行清单，不是实测报告。
