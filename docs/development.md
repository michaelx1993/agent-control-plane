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
