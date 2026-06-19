# Agent Control Plane PRD

## 背景

当前 Symphony + Linear 方案已经验证了用 issue 状态驱动 agent 的基本可行性，但暴露出两个核心问题：

- Linear API 限制较多，不适合作为高频 agent runtime 状态库。
- Agent prompt 仍放在 GitHub/Markdown 中，修改、版本、发布和回滚都不够产品化。
- Agent 执行过程主要靠本地日志，缺少可视化的完整 conversation、tool call、token 和成本视图。

新的方案拆成四层。Agent Control Plane 是 Symphony 的替代编排层，不是 Plane 或 OpenHands
的别名：

```text
Plane
  任务、项目、状态、人类 review
      |
      v
Agent Control Plane
  任务发现、状态机、repo routing、并发、lease、重试、结果同步
      |
      v
OpenHands SDK
  agent 执行、workspace、conversation、event log、工具调用
      |
      v
Langfuse
  prompt registry、prompt version、LLM trace、token/cost、eval
```

## 已定决策

- Plane 必须 self-host，因为后续一定会二次开发。
- Plane 是人类任务平台，Control Plane 是 agent 调度平台。
- Agent Control Plane 逐步替代 Symphony 的任务发现、状态机、prompt 装配、run/lease 和观测编排能力。
- Prompt 主库优先放在 Control Plane，Langfuse 负责 trace、eval 和效果分析。
- Trace 不按多租户隐私产品设计，默认完整记录，方便个人调试。
- token project 下不再拆 crs/sub2/traffic 多个 project，统一用 repo 字段路由。
- repo 字段短期可用 label 兜底，正式设计应使用 Plane 自定义字段或二开字段。

## 产品目标

1. 用 Plane 替代 Linear 承载任务和人工流程。
2. 用 Agent Control Plane 替代把 agent runtime 状态塞进任务系统。
3. 用平台化 prompt 管理替代 GitHub 私有 prompt 仓库。
4. 用 OpenHands event log + Langfuse trace 打开 agent 执行黑盒。
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
- human review gate
- agent run 链接展示
- OpenHands / Langfuse 跳转入口

Control Plane 面向 agent runtime，负责“哪个 agent 什么时候接单、怎么跑、跑成什么样”：

- task mirror
- repo routing
- run / lease / heartbeat / retry
- prompt component / binding / release
- OpenHands conversation ref
- Langfuse trace ref
- state transition validation
- low-frequency Plane status comment: Claimed / Running / Completed / Failed
- review feedback write path and Development rework trigger

Plane 可以展示 agent 状态，但不承载高频 heartbeat、retry、token、conversation event log 和 prompt release 事实源。

当前实现约束：

- 高频 heartbeat 只写 Control Plane `runs/run_events`，不写 Plane comment。
- Plane comment 只写低频状态和最终结果，避免触发 Plane rate limit。
- Review 打回可在 Run Detail 页面或 API 写入 feedback，并可将 task 退回 Development。

## 用户角色

| 角色           | 诉求                                                 |
| -------------- | ---------------------------------------------------- |
| Owner          | 管理 team/project/repo/prompt，查看 agent 成本和质量 |
| Product/PM     | 创建任务、指定 repo、查看状态、做人工 review         |
| Engineer       | 查看 agent 变更、PR、测试结果、打回返工              |
| Agent Operator | 查看运行队列、lease、失败重试、日志和 trace          |
| Agent          | 读取任务上下文、加载 prompt、执行代码、回写结果      |

## 核心对象

| 对象             | 说明                                                          |
| ---------------- | ------------------------------------------------------------- |
| Team             | 业务团队，例如 `token-team`、`tiktok-team`                    |
| Project          | 产品/业务项目，例如 `token`、`tiktok-test`                    |
| Repository       | 代码仓库，例如 `crs-src`、`sub3`、`traffic`                   |
| Task             | 从 Plane 同步来的任务                                         |
| Role             | agent 角色，例如 Intake、Development、Code Review、Merge      |
| Agent Definition | 平台里配置的 agent，包含模型、工具、权限、默认 prompt binding |
| Prompt Component | 可复用 prompt 片段，例如 global/team/project/repo/role        |
| Prompt Release   | prompt 版本发布结果                                           |
| Run              | 一次 agent 接单执行                                           |
| Conversation     | OpenHands conversation 引用                                   |
| Trace            | Langfuse trace 引用                                           |

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
-> Release Version
-> Released
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
Release Version
Deployment
```

人工判定状态：

```text
Human Review
Merged
Released
Deployed
Blocked
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
Blocked -> Development
```

返工规则：

- 人类或 reviewer 打回时，必须写明问题来源。
- Agent 每次接单前必须读取任务描述、所有有效评论、最新 workpad、PR review feedback。
- Development agent 必须把返工建议写入本次 run 的 workpad 和最终 summary。
- `Blocked` 是 Control Plane stalled/人工处理状态，不进入主链；通常由 lease 超时、预算熔断或人工阻塞触发。

## 任务分发规则

任务被 Agent Control Plane 接单的最低条件：

- task 属于启用的 team/project。
- task 有明确 repo。
- task 处于自动执行状态。
- task 没有被其他 active run 持有 lease。
- task 不处于 `Blocked` / human-required gate。

repo 必填规则：

```text
project = token
repo = crs-src | sub3 | traffic
```

未来所有 token project 任务不再拆成多个 Linear/Plane project，而是在同一个 project 下通过 repo 字段路由。MVP 允许 `repo:<name>` label 兜底，但正式方案应二开 Plane 字段。

## Prompt 装配

Prompt 不再以 GitHub Markdown 为权威源。平台按以下顺序动态装配：

```text
global prompt
+ team prompt
+ project prompt
+ repo prompt
+ role prompt
+ task context
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

当前 Prompt Manager 已支持：

- 创建 prompt component。
- 创建 prompt binding。
- 从平台列出 team/project/repo/role/agent scope，避免手填 UUID。
- 对比两个 prompt component 版本的行级 diff。
- 将旧 prompt component 版本回滚为新的 active 版本，并归档同 scope/name 下旧 active 版本。
- 每次 worker run 按 global/team/project/repo/role/agent 顺序装配 active prompt。

## OpenHands 集成

Agent Control Plane 不直接执行 shell/file/tool，而是调用 OpenHands SDK：

1. 创建或恢复 conversation。
2. 指定 workspace/repo。
3. 注入已装配 prompt。
4. 启动 run。
5. 监听 event log。
6. 保存 conversation id、event cursor、run result。
7. 根据结果更新 Plane 状态。

OpenHands 负责：

- agent loop
- conversation state
- event log
- workspace
- shell/file/tool execution
- stuck detection

## Langfuse 集成

Langfuse 负责：

- prompt registry
- prompt version / label
- LLM trace
- token/cost
- latency
- model output
- eval / annotation

每次 OpenHands 调用 LLM 时，必须写入 Langfuse trace，并关联：

- task id
- run id
- conversation id
- agent definition id
- prompt release id
- model
- repo
- role

Trace 策略：

- Langfuse 默认保存完整 prompt、response、tool call、token、cost、latency。
- Control Plane 默认保存最终 prompt 快照、trace 引用和 token/cost 摘要。
- 不做复杂脱敏管线，只做最小 secret 防护：不主动把 `.env`、API key、SSH key 写进 prompt 或 trace。

## 页面需求

### Task Queue

- 按 team/project/repo/state 过滤。
- 展示可接单、运行中、阻塞、等待人工 review 的任务。
- 展示当前 lease owner、heartbeat、run duration。

### Agent Runs

- 查看每次 run 的状态、耗时、token、成本、结果。
- 跳转 OpenHands conversation。
- 跳转 Langfuse trace。
- 展示本次使用的 prompt release。
- 展示并新增 feedback；需要返工时可将任务退回 Development。
- Prompt Metrics 页面按 prompt release 展示历史 run 数、成功率、平均 token 和平均成本。

### Prompt Manager

- 创建 global/team/project/repo/role prompt。
- 创建 team/project/repo/role/agent prompt binding。
- 选择已有 scope 绑定 prompt，不要求用户手填 scope UUID。
- diff prompt version。
- 发布 active 版本。
- 回滚到旧版本。
- 查看某 prompt version 关联的 run 质量和成本。

### Project Settings

- 管理 repo 列表。
- 管理状态机映射。
- 管理 repo routing 规则。
- 管理 agent role 到 agent definition 的绑定。

## MVP 范围

当前完成度说明：

- 已完成的是 Control Plane 本地 MVP：数据库模型、mock worker、run/lease/heartbeat、prompt 平台、run detail、feedback/rework、Operator Timeline、Readiness、人工 transition API。
- 未完成的是完整产品：Plane self-host 实测、真实 Plane API/webhook 同步、真实 OpenHands 执行、真实 Langfuse trace、生产部署和权限治理。
- 因此当前系统可以用于本地验证和控制台流程验收，还不能宣称已经替代 Symphony 跑生产任务。

第一阶段：

- Plane project/task 同步。
- 单 project 多 repo 路由。
- 平台化 prompt component CRUD。
- Prompt 装配并生成 prompt release。
- OpenHands SDK 执行一次 Development run。
- 保存 run/conversation/trace 引用。
- 状态同步回 Plane。
- 基础 run 列表和详情页。
- Operator Timeline：聚合 run event、audit event、feedback，给网页版查看 agent 接单/运行/完成/失败过程。
- Readiness：在控制台展示 Plane/OpenHands/Langfuse/DB/Worker 配置缺口。

第二阶段：

- Code Review / In Merge / Release Version / Deployment 角色。
- 人工 gate API：允许人类将 Merged/Released/Deployed 等 gate 推进、打回 Development，或直接 Done/Canceled。
- retry/backoff/lease 可视化。
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
- 用户可以打开一次 run，看到 OpenHands conversation/event log。
- 用户可以打开 Langfuse trace，看到 LLM 输入输出、prompt version、token 和成本。
- Agent 完成后可以自动推动任务进入下一个状态。
- 人类可以在 review gate 打回 Development，并且 agent 下一次能读到打回意见。
- 人类可以在控制台看到最近 operator timeline，不需要 tail 本地日志判断 agent 是否接单。
- 上线前可以通过 readiness 检查确认 Plane/OpenHands/Langfuse/DB/Worker 配置是否齐全。

## 关键风险

- Plane API/webhook 能力需要验证，不足时要补 adapter 或退回 polling。
- OpenHands SDK 与现有 Codex 能力边界不同，需要验证模型、工具、权限和 workspace 隔离。
- Langfuse trace 会默认记录完整上下文，调试便利优先；只做最低限度 secret 防护。
- Prompt 平台化后必须有发布流程，否则线上 agent 行为会被随意改坏。
- 多 repo 任务如果 repo 字段缺失，必须拒绝接单，不能猜。
