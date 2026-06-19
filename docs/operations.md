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
  pnpm --filter @agent-control-plane/db exec tsx -e 'import { prisma } from "./src/index.ts"; void (async()=>{ const [teams,repos,roles]=await Promise.all([prisma.team.count(), prisma.repository.count(), prisma.role.count()]); console.log(JSON.stringify({teams,repos,roles})); await prisma.$disconnect(); })();'
```

Expected seed baseline:

```json
{ "teams": 1, "repos": 3, "roles": 4 }
```

## Validation

```bash
pnpm format
pnpm typecheck
pnpm test
pnpm build
pnpm worker:dry-run
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
- `WORKER_MODE=live` is only enabled after a successful mock run and DB migration.
