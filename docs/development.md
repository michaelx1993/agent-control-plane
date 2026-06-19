# Development

## Model Policy

Agent team development uses `gpt-5.5` with medium reasoning unless a task is
explicitly downgraded for cost or upgraded for a hard debugging pass.

## Package Boundaries

- `apps/web` owns the operator UI and HTTP routes.
- `apps/worker` owns long-running dispatch and integration loops.
- `packages/db` owns Prisma schema, migrations, seed, and persistence helpers.
- `packages/shared` owns cross-package types and tiny utilities.
- `packages/state-machine` owns workflow state rules.
- `packages/repo-router` owns repository selection.
- `packages/prompt` owns prompt composition and release metadata.
- `packages/plane`, `packages/openhands`, and `packages/langfuse` own external adapters.

Workspace package `main` and `types` should point at `src/index.ts` while packages are private.
CI runs typecheck before build, so internal imports must not depend on generated `dist/*.d.ts`.

## Documentation Discipline

Any change that alters architecture, state transitions, persistence, prompt assembly, runtime
behavior, operator workflows, or external integrations must update docs in the same commit.

Primary docs:

- `docs/agent-control-plane-prd.md` for product and boundary decisions.
- `docs/agent-control-plane-erd.md` for persisted data and key queries.
- `docs/agent-control-plane-roadmap.md` for phase status and next work.
- `docs/operations.md` for runbooks and operator actions.

## First Milestone

The first milestone is an end-to-end mock/control-plane run:

```text
mock Plane task
-> repo routing
-> prompt release
-> worker dispatch
-> mock OpenHands result
-> mock Langfuse trace
-> run detail in web UI
```

The mock run must pass typecheck and unit tests before real Plane/OpenHands
credentials are introduced.

Current status:

- The mock/control-plane milestone is complete.
- The web console exposes task queue, runs, run detail, prompt manager, Operator Timeline, and
  Readiness.
- Readiness shows DB seed baseline status when `DATABASE_URL` is configured, so operators can catch
  an empty Control Plane database before live dispatch.
- The worker can execute a mock dispatch and persist/return run state.
- Code Review `major`/`blocker` feedback sends work back to Development.
- Live Plane/OpenHands/Langfuse execution is the next milestone, not yet complete.

## Demo Run Data

The base database seed creates teams, repositories, roles, and default agent
definitions only. To verify run detail UI locally without waiting for a live
Plane/OpenHands/Langfuse run, load one explicit demo run:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" pnpm --filter @agent-control-plane/db seed
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" pnpm db:seed-demo
```

The demo run is `00000000-0000-4000-9000-000000000001` and includes a task,
prompt release, OpenHands conversation ref, Langfuse trace ref, run events, and
one feedback item. This seed is opt-in and should not be used for production
data.

Run Detail supports adding feedback from the UI. When `returnToDevelopment=true`, the task is moved
back to Development and unresolved feedback is injected into the next worker prompt as comments.

## Live Worker Preconditions

`WORKER_MODE=live` intentionally fails fast unless the runtime integrations are
configured:

- `PLANE_BASE_URL`, `PLANE_WORKSPACE_SLUG`, and `PLANE_PROJECT_ID`
- `OPENHANDS_BASE_URL`
- `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`

The worker uses mock OpenHands and mock tracing only when `WORKER_MODE=mock`.
Plane API key auth defaults to `X-API-Key`, matching self-host Personal Access Tokens. Use
`PLANE_API_KEY_HEADER=Authorization` only when a deployment expects bearer auth.
OpenHands runtime API paths default to `OPENHANDS_CONVERSATIONS_PATH=/api/conversations` and
`OPENHANDS_RUNS_PATH=/api/runs`; override them when the target OpenHands SDK server exposes
different routes.
Langfuse runtime API paths default to `LANGFUSE_TRACES_PATH=/api/public/traces` and
`LANGFUSE_GENERATIONS_PATH=/api/public/generations`; override them when a self-hosted Langfuse
deployment exposes different API routes.

Run `pnpm live:preflight` before enabling live mode. It performs non-mutating probes:

- `SELECT 1` and Control Plane seed baseline checks against PostgreSQL.
- `Plane listTasks({ perPage: 1 })` against the configured workspace/project.
- HTTP health probe against `OPENHANDS_BASE_URL + OPENHANDS_HEALTH_PATH` where the default path is
  `/health`.
- HTTP health probe against `LANGFUSE_BASE_URL + LANGFUSE_HEALTH_PATH` where the default path is
  `/api/public/health`.

If a self-hosted service exposes a different health endpoint, set `OPENHANDS_HEALTH_PATH` or
`LANGFUSE_HEALTH_PATH` instead of changing code.

Use one-shot live dispatch for the first real Development task:

```bash
WORKER_MODE="live" pnpm live:dispatch-once
```

It runs live preflight before dispatching and prints a JSON evidence bundle:

- `task`: Control Plane task id, Plane task id, team/project/repo, and post-dispatch state.
- `run`: run id, status, role, attempt, prompt release id, OpenHands conversation id/url,
  Langfuse trace id/url, next state, summary, and error if present.
- `verification`: direct evidence handles for the operator: `/runs/<run_id>`, Plane task id,
  OpenHands evidence, Langfuse evidence, and expected next state.
