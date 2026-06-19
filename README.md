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

## Design Docs

- [PRD](docs/agent-control-plane-prd.md)
- [ERD](docs/agent-control-plane-erd.md)
- [Roadmap](docs/agent-control-plane-roadmap.md)
  Agent Control Plane for Plane, OpenHands, and Langfuse based software-agent orchestration
