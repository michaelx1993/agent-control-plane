# Operations

## Local Services

Start the local PostgreSQL dependency:

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres
```

Apply migrations and seed baseline data:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
  pnpm --filter @agent-control-plane/db prisma:migrate --name init

DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
  pnpm --filter @agent-control-plane/db seed
```

Run a smoke query:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
  pnpm --filter @agent-control-plane/db exec tsx -e 'import { prisma } from "./src/index.ts"; void (async()=>{ const [teams,repos,roles,agents]=await Promise.all([prisma.team.count(), prisma.repository.count(), prisma.role.count(), prisma.agentDefinition.count()]); console.log(JSON.stringify({teams,repos,roles,agents})); await prisma.$disconnect(); })();'
```

Expected seed baseline:

```json
{ "teams": 1, "repos": 3, "roles": 6, "agents": 6 }
```

## Validation

```bash
pnpm format
pnpm typecheck
pnpm test
pnpm build
pnpm worker:dry-run
```

Use the scripted release gate before any live worker rollout:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
  CONTROL_PLANE_BASE_URL="http://127.0.0.1:3100" \
  pnpm release:check
```

## Health Checks

```bash
CONTROL_PLANE_BASE_URL="http://127.0.0.1:3100" pnpm health
```

The check validates:

- `/api/health`
- `/api/tasks`
- `/api/runs`
- `/api/prompt-releases`
- `/api/prompt-components`

## Backup And Restore

Create a PostgreSQL custom-format backup:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
  scripts/db-backup.sh
```

Restore explicitly from a backup file:

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
  scripts/db-restore.sh backups/agent-control-plane-YYYYMMDDTHHMMSSZ.dump
```

## Plane Fork

The Plane fork for future self-host customization is:

```text
https://github.com/michaelx1993/plane
```

The first production decision is whether repo routing can be implemented with Plane custom
properties or requires a small Plane schema/UI patch.

## Release Gate

Before using the worker against live systems:

- Plane self-host URL and API token are configured.
- `PLANE_WORKSPACE_SLUG` and `PLANE_PROJECT_ID` are known.
- OpenHands adapter endpoint is verified.
- Langfuse keys are configured.
- `WORKER_MODE=live` has `OPENHANDS_BASE_URL`, `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`; the worker fails fast without them.
- `WORKER_DEFAULT_REPO_CONCURRENCY=1` unless a repo is known safe for parallel edits.
- A database backup exists for the target environment.
- `WORKER_MODE=live` is only enabled after a successful mock run and DB migration.
