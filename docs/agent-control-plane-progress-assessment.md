# Agent Control Plane 进度与工作量评估

更新时间：2026-06-20

本文用于回答“现在做到哪了、还差多少、为什么不用 Symphony 直接解决”。若与旧段落冲突，以本文和 `agent-control-plane-status.md` 的“总判定 / 方案调整”为准。

## 当前架构判定

最终第一版架构是三个常驻进程：

```text
Plane
  人类任务、项目、状态、评论、人工 review

Agent Control Plane
  prompt 平台、状态机、调度、run/lease、progress/workpad、审计、UI

Worker
  认领任务、准备 workspace、启动 Codex、消费事件、写回进度和状态
```

Worker 承担的是 Symphony 里“接单并驱动 Codex 执行”的核心功能，但它不是简单复制 Symphony。我们保留 Symphony 已验证过的执行经验，尤其是 `codex app-server` / `thread/start` / `turn/start` 的执行模型；当前仓库已落地 `codex exec --json` 形态的第一阶段 `codex-cli` adapter，也已用本机真实 Codex 跑通 `codex-app-server` follow-up 两轮同 task thread reuse；下一步重点是把同样链路放到真实 Plane task 派发路径中验收。

## 为什么不直接用 Symphony

Symphony 适合作为执行编排参考，不适合作为最终工作平台：

- Prompt 管理：我们需要 global / team / project / repo / role / agent / task context 动态组装，且要审批、版本、回滚、审计。Symphony 更偏配置文件和 workflow。
- 执行可见性：我们需要 Web UI 直接看到 agent 是否接单、Running/Completed/Failed、run events、Progress、Workpad、反馈、状态流转证据。Symphony 主要依赖本地日志和外部任务评论。
- 状态机：我们的流程有多个人工 gate、允许中途 Done、允许 review 打回 Development，且需要 Plane 状态和 Control Plane 状态一致。
- 多项目/多 repo：我们需要按 team/project/repo/role/state/priority/budget/concurrency 做调度，而不是只靠单一 workflow polling。
- 二次开发：我们要替代 Linear 的一部分限制，并把 prompt、agent profile、调度策略和验收证据做成自己的平台能力。

## 我们比 Symphony 的优势

- 平台化 prompt：不用改 Markdown / GitHub 才能调整 agent 行为。
- 任务运行透明：接单、运行、失败、完成、打回、下一状态都有数据库事实源和 Web 可视化。
- 状态机可控：自动状态和人工 gate 分离，允许打回、短路 Done、审计所有人工操作。
- 多 repo 调度：同一个项目可路由到多个仓库，支持 repo 并发、公平队列、预算门禁。
- 低成本默认链路：默认使用本机已有 Codex CLI / `codex app-server`，不把 OpenHands Cloud、Langfuse Cloud 或企业 license 放进第一版必需路径。
- 可演进 adapter：第一版 `codex-cli`，后续可以接 Symphony adapter、OpenHands adapter、remote worker adapter，但不能让付费外部平台阻断核心闭环。

## 当前完成度

按产品模块估算：

| 模块                            | 当前进度 | 说明                                                                                                                                                                                                                                                                                           |
| ------------------------------- | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plane self-host / API / webhook |      70% | 本机 self-host、API smoke、webhook smoke、sync/writeback harness 已有；真实人工 gate 回写仍需 staging 复测。                                                                                                                                                                                   |
| Control Plane Runtime           |      78% | run、lease、heartbeat、retry、stalled、queue、权限、监控、workpad/progress 已有本地闭环；`/api/tasks` 与 `/api/runs` 已在本机真实 PostgreSQL 上复测通过；真实 Codex `codex-app-server` follow-up 两轮同 task thread reuse 已在临时 DB / git-worktree 链路跑通。                                |
| Prompt 平台                     |      80% | component、binding、approval、release、rollback、RBAC、audit 已有最小产品能力。                                                                                                                                                                                                                |
| Worker 通用执行框架             |      75% | adapter 抽象、workspace、run events、状态推进、crash/lease/budget/workflow smoke 已有；`worker:codex-smoke` 已证明 Codex adapter 可经 Worker/DB/workspace 跑通。                                                                                                                               |
| Codex CLI / app-server 执行器   |      72% | 已有 `codex exec --json` adapter、错误/超时/脱敏处理、单测、`codex:adapter-smoke`、DB-driven `worker:codex-smoke`、opt-in `worker:codex-real-smoke` 和 opt-in `worker:codex-plane-smoke`；本机真实 `codex-app-server` follow-up thread reuse 已跑通；还缺真实 Plane 派发路径和真实长任务校准。 |
| 本地观测                        |      70% | run events、Progress、Workpad、audit、dashboard 已有；Worker 已把高信号 Codex/OpenHands 事件写入任务级 Agent Events Progress；还要用真实 Codex 长任务校准事件分类和噪声过滤。                                                                                                                  |
| OpenHands / Langfuse 可选集成   |      45% | 骨架和 smoke 已有，但已降级为 optional，不再作为第一版完成条件。                                                                                                                                                                                                                               |
| Cutover / Completion 门禁       |      75% | 本地 mock rehearsal、preflight、audit、final 脚本都有；`ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 默认 profile 已落地并通过本地 smoke，OpenHands/Langfuse 已转为 legacy/optional profile。                                                                                                   |

整体判断：

- 本地平台骨架和 mock 闭环：约 72%。
- “省钱版可真实干活”的 Codex-first 闭环：约 65%。
- 可替代当前 Symphony + Linear 日常使用的最小版本：约 65%。
- 生产级稳定替换：约 35%。

## 剩余工作量

按一个熟悉当前仓库的工程师估算：

| 阶段 | 工作内容                                                                                        |     粗估 |
| ---- | ----------------------------------------------------------------------------------------------- | -------: |
| A    | Codex adapter 产品化：真实 Plane 任务执行、状态/失败映射、Plane follow-up thread reuse 复测     | 0.5-1 天 |
| B    | Codex run events -> Progress / Workpad / Run Detail：消息、命令、文件、状态、summary 映射       | 0.5-1 天 |
| C    | completion/cutover 脚本 profile 化：`codex-cli` 为默认，OpenHands/Langfuse 变 optional evidence |   已完成 |
| D    | Plane staging 复测：sync、人工 gate、rework、comment writeback、task-source smoke               | 0.5-1 天 |
| E    | 真实 repo 端到端：从 Plane 创建任务，Worker 用 Codex 修改代码，写回状态和 summary               |   1-2 天 |
| F    | 稳定性收尾：并发、crash、workspace cleanup、预算、权限、文档和 CI 回归                          |   1-2 天 |

最乐观还需要 4-6 个有效工程日做出可日常试用版；若要生产级替换，需要再加 1-2 周做真实长期运行、异常恢复、UI 打磨和迁移演练。

## 下一批优先任务

1. 填写 codex-first `.secrets/completion-final.env` 中的 Plane/API/operator/secret provider/final evidence 变量；当前 `pnpm completion:doctor` 已确认 OpenHands/Langfuse 不再是默认缺口，剩余 `missing_count=31`。
2. 用真实 Plane task + 真实 repo 跑通 `WORKER_EXECUTION_ADAPTER=codex-cli` 或 `codex-app-server` 的 Development -> Code Review；本地 DB-driven fake Codex 链路已由 `pnpm worker:codex-smoke` 覆盖，真实 Plane+Codex opt-in 入口为 `pnpm worker:codex-plane-smoke`，Plane follow-up 复测使用 `WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true`。
3. 用真实 Codex 事件流校准 `run_events` / Progress / Workpad / Run Detail 的分类、截断和噪声过滤。
4. 用真实 cutover report 验证 `ACP_COMPLETION_EXECUTION_PROFILE=codex-cli` 默认口径，覆盖 Codex run evidence、Progress/Workpad、Plane writeback、task-source、secret provider 和 provider audit。
5. 在 Plane UI 回读状态和 comment，确认人工 gate 打回后 Development prompt 能读到反馈。
6. 视真实任务耗时与上下文成本决定是否把 `codex app-server/thread/turn` 作为默认 Plane 执行器，而不是只在 follow-up smoke 中启用。

## 多 Agent 开发协议

后续并发开发必须走 worktree 模式，避免多个 agent 在同一个 dirty 工作区互相覆盖：

```bash
git fetch origin
git worktree add ../worktrees/<issue-or-module> -b <branch-name> origin/main
```

规则：

- 每个 subagent 只在自己的 `../worktrees/<issue-or-module>` 内开发。
- 每个 subagent 只拥有分配给它的文件集合，不能跨文件锁。
- subagent 完成后只提交自己的分支或返回 patch 摘要，不直接合入 `main`。
- main agent 负责 review、跑测试、解决冲突、开 PR、合并 PR。
- 同一 issue 的多分支合并顺序由 main agent 决定；出现冲突时以产品架构和测试为准，不让 subagent 自行抢合。

## 当前风险

- 若历史段落提到 OpenHands/Langfuse 证据，默认按 optional/legacy profile 解读；第一版完成口径以本文、PRD 顶部“已定决策”和 Status 顶部“方案调整”的 Codex-first 证据为准。
- `codex-cli` adapter 只有第一阶段 `codex exec --json` 实现，且 `worker:codex-smoke` 使用 fake Codex 验证 Worker/DB 链路，所以现在不能声明“已经替代 Symphony”。
- 当前本地 smoke 证明代码链路和脚本门禁能跑，不证明真实 Plane + Codex Worker 已经完成 cutover。
- 不引入 Langfuse 后，早期观测能力会比专用 trace 平台弱；第一版用 Control Plane 自己的 run events / workpad / audit 顶住，后续按需要再增强。
