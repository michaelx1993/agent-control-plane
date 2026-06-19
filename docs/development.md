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

## First Milestone

The first milestone is an end-to-end mock run:

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
