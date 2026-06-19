# Agent Control Plane

Agent Control Plane is a self-hosted orchestration layer for software-agent work.
It connects Plane, OpenHands, and Langfuse while keeping high-frequency agent
runtime state out of the human-facing task tracker.

## Architecture

```text
Plane
  human task/project/state/review surface
      |
      v
Agent Control Plane
  task mirror, repo routing, leases, runs, prompt releases
      |
      v
OpenHands
  agent execution, workspace, conversation, event log
      |
      v
Langfuse
  LLM traces, prompt/run analytics, token and cost
```

## Current Status

The Control Plane codebase now has a verified local/operator MVP:

- Task queue, run/lease/heartbeat, retry cap, manual retry release.
- Prompt component/binding/release management.
- Run detail with feedback, OpenHands/Langfuse refs, event payloads, and prompt snapshot.
- Operator Timeline and Readiness panels for web-based operations.
- Manual workflow transition API with state-machine validation.
- Mock worker dry run and database-backed demo run.

The full product is not finished yet. The remaining critical path is live integration:

- Plane self-host must be started and validated against real API/webhook behavior.
- Worker must run against a real OpenHands endpoint instead of the mock adapter.
- Langfuse must receive real traces from live OpenHands/LLM execution.
- Production deployment, permissions, backup/restore, and long-running ops still need hardening.

## Workspace

```text
apps/
  web/       Admin UI and API routes
  worker/    dispatch loop and runtime integrations
packages/
  db/          Prisma schema and runtime queries
  plane/       Plane adapter
  openhands/   OpenHands adapter
  langfuse/    Langfuse adapter
  prompt/      prompt composition and release helpers
  repo-router/ repo selection rules
  state-machine/
  shared/
infra/
  docker/    local infrastructure
docs/
```

## Local Development

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d
pnpm --filter @agent-control-plane/db prisma:generate
pnpm --filter @agent-control-plane/db prisma:migrate
pnpm dev
```

Run the worker in a second shell:

```bash
pnpm worker
```

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

Run the full release gate with a configured database:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" pnpm release:check
```

Before turning on `WORKER_MODE=live`, run the non-mutating live preflight:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
PLANE_BASE_URL="https://plane.example" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="..." \
OPENHANDS_BASE_URL="https://openhands.example" \
OPENHANDS_CONVERSATIONS_PATH="/api/conversations" \
OPENHANDS_RUNS_PATH="/api/runs" \
LANGFUSE_BASE_URL="https://langfuse.example" \
LANGFUSE_TRACES_PATH="/api/public/traces" \
LANGFUSE_GENERATIONS_PATH="/api/public/generations" \
LANGFUSE_PUBLIC_KEY="pk" \
LANGFUSE_SECRET_KEY="sk" \
pnpm live:preflight
```

The preflight checks DB connectivity and seed baseline rows, Plane work item listing, OpenHands
health, and Langfuse health without creating tasks, conversations, or traces. The web Readiness
panel shows the same DB baseline risk when `DATABASE_URL` is configured.
Plane self-host Personal Access Tokens use `X-API-Key` by default; set
`PLANE_API_KEY_HEADER=Authorization` only for OAuth/bearer-compatible deployments.
Use `pnpm plane:probe` during the Plane self-host spike to verify list/get/repo parsing; set
`PLANE_PROBE_MUTATE=true` with `PLANE_PROBE_TASK_ID`, `PLANE_PROBE_PATCH_JSON`, and
`PLANE_PROBE_COMMENT_BODY` only against a disposable spike task when validating PATCH/comment APIs.

For live rollout, run `scripts/db-backup.sh` first. `pnpm release:check` requires a non-empty
`BACKUP_FILE` or the latest `agent-control-plane-*.dump` under `BACKUP_DIR` when `WORKER_MODE=live`.
Use `WORKER_MODE=live pnpm live:verify-once` for the first real Development task; it runs
preflight first, dispatches one task, prints the JSON evidence bundle, and fails if Plane,
workspace, OpenHands, Langfuse, or Control Plane Run Detail evidence is missing. Use
`WORKER_MODE=live pnpm live:dispatch-once` when you only need the raw dispatch JSON.

## Design Docs

- [PRD](docs/agent-control-plane-prd.md)
- [ERD](docs/agent-control-plane-erd.md)
- [Roadmap](docs/agent-control-plane-roadmap.md)
  Agent Control Plane for Plane, OpenHands, and Langfuse based software-agent orchestration
