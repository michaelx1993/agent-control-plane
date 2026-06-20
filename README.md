# Agent Control Plane

Self-hosted control plane for software-agent work.

This repository owns the Web/API process and the PostgreSQL-backed runtime state. It does not contain the distributed Worker daemon; production workers live in `michaelx1993/agent-worker` and communicate through the internal Worker API.

## Architecture

```text
Plane
  human task/project/state/review surface
      |
      | webhook / Plane API
      v
Agent Control Plane
  operator UI, prompt/runtime DB, state machine, lease, audit,
  Worker API, Plane sync/writeback, cutover scripts
      |
      | HTTPS Worker API
      v
agent-worker
  Codex CLI / codex app-server execution in isolated workspaces
```

Only Agent Control Plane holds `DATABASE_URL` and Plane API credentials. Workers hold a worker token and call `/api/worker/v1/*`.

## Workspace

```text
apps/web        Next.js operator UI and HTTP APIs
packages/core   state machine, routing, Worker API contract
packages/db     Prisma schema, migrations, pg query services
packages/plane  Plane API/webhook client helpers
docs            PRD, ERD, roadmap, TODO, runbooks
scripts         deploy, rollback, backup, smoke, cutover helpers
```

## Development

```bash
pnpm install
pnpm format
pnpm typecheck
pnpm test
pnpm build
```

Database validation:

```bash
pnpm db:validate
pnpm db:migrate
pnpm db:seed
```

Run the web/API process:

```bash
cp .env.example .env
pnpm dev
```

## Worker API

The Worker API contract is exposed by the web process:

```text
GET  /api/worker/v1/openapi.json
POST /api/worker/v1/register
POST /api/worker/v1/runs/claim
POST /api/worker/v1/runs/:runId/heartbeat
POST /api/worker/v1/runs/:runId/events
POST /api/worker/v1/runs/:runId/progress
POST /api/worker/v1/runs/:runId/artifacts
POST /api/worker/v1/runs/:runId/complete
POST /api/worker/v1/runs/:runId/fail
```

Worker writes require `x-acp-worker-id`, bearer auth when configured, lease ownership checks, and idempotency keys.

## Deployment

```bash
docker build -t agent-control-plane:local .
docker compose up -d
pnpm deploy:compose
pnpm rollback:compose
```

Backup and restore helpers:

```bash
pnpm db:backup
pnpm db:restore
```

## Docs

- `docs/todo.md`
- `docs/agent-control-plane-prd.md`
- `docs/agent-control-plane-erd.md`
- `docs/agent-control-plane-roadmap.md`
