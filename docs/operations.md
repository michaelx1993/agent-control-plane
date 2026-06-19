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

Documentation must be updated in the same change whenever architecture, workflow, data model,
runtime behavior, or operator process changes. Treat `docs/agent-control-plane-prd.md`,
`docs/agent-control-plane-erd.md`, `docs/agent-control-plane-roadmap.md`, and this runbook as part
of the delivery surface.

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
- `/api/timeline`
- `/api/readiness`
- `/api/prompt-releases`
- `/api/prompt-components`
- `/api/prompt-scopes`

## Operator Timeline And Readiness

The web console exposes two operator-facing surfaces that should be checked before running live
agents:

- `GET /api/timeline` aggregates recent `run_events`, `audit_events`, and `feedback_items`.
  It is the low-noise view for "did an agent claim, run, fail, or complete?"
- `GET /api/readiness` reports Plane, OpenHands, Langfuse, database, and worker configuration
  readiness. Missing required live integration variables are `missing`; optional or defaulted
  variables are `warning`.

The dashboard renders both panels. Use them before tailing process logs; logs remain a debug
fallback, not the normal operating surface.

## Worker Heartbeats

Worker heartbeats refresh the local Control Plane run lease while OpenHands is still executing.
They are not written to Plane, so they do not consume Plane API quota.

Default configuration:

```bash
WORKER_LEASE_MS="900000"
WORKER_HEARTBEAT_INTERVAL_MS="30000"
WORKER_MAX_TASK_ATTEMPTS="3"
OPENHANDS_POLL_INTERVAL_MS="1000"
OPENHANDS_POLL_ATTEMPTS="300"
```

Operational rule:

- Keep `WORKER_HEARTBEAT_INTERVAL_MS` lower than `WORKER_LEASE_MS`.
- Set it high enough to avoid noisy `run_events`; `30000` means at most two heartbeat events per minute per active run.
- Use run detail and dashboard heartbeat age to distinguish active long-running work from a stale lease.
- When the DB-backed worker finds an expired claimed/running lease, it marks the run `blocked`,
  records a `blocked` run event, clears the lease, and moves the task to `Blocked`. This is the
  Control Plane stalled state; an operator must inspect the run detail before returning the task to
  Development or closing it.

## Worker Retry Limit

`WORKER_MAX_TASK_ATTEMPTS` caps how many runs a task can receive before the worker stops
dispatching it automatically. The default is `3`.

Operational rule:

- A new run gets `attempt = max(previous task attempts) + 1`.
- Dispatch skips a task once its max attempt is greater than or equal to
  `WORKER_MAX_TASK_ATTEMPTS`.
- The Task Queue exposes these tasks as `retry capped` with `attempt/maxAttempts`, so operators
  can distinguish them from normal human gates.
- Use the Task Queue `Release retry` action to set the task retry baseline to its current max
  attempt. Historical runs stay immutable, and the next worker attempt opens a fresh retry window.
- Reviewers should add feedback or mark the task blocked/done after the retry cap is reached.
  This prevents failing tasks from looping silently through the worker.

## Plane Polling Fallback

The live worker calls Plane sync before each dispatch pass. This is a reconciliation fallback for
missed or incomplete webhooks, not the primary event stream.

Default configuration:

```bash
PLANE_SYNC_MIN_INTERVAL_MS="60000"
PLANE_SYNC_PER_PAGE="100"
```

Operational rule:

- `PLANE_SYNC_MIN_INTERVAL_MS=60000` keeps one worker to at most 60 Plane list requests per hour for
  fallback polling.
- `PLANE_SYNC_PER_PAGE` is clamped to `1..100`.
- The first sync is full project reconciliation. Later syncs use the previous successful sync start
  timestamp as `updated_since`, so changes during an in-flight sync are picked up in the next pass.
- Keep webhooks enabled even with polling fallback; polling is for healing missed events and startup
  reconciliation.

## Review Rework Feedback

When Code Review or Human Review rejects work, use the Run Detail feedback form first. It writes
feedback and can move the task back to Development in one action.

The API is also available for scripts:

```bash
curl -X POST "${CONTROL_PLANE_BASE_URL}/api/runs/<run-id>/feedback" \
  -H "content-type: application/json" \
  -d '{
    "source": "human",
    "severity": "major",
    "body": "Fix the review findings before returning to Code Review.",
    "returnToDevelopment": true
  }'
```

This writes `feedback_items`, records a run event when `returnToDevelopment=true`, and lets the
next Development agent see unresolved feedback through the task/run context.

The Development worker reads unresolved feedback as task comments before assembling the next prompt.
Code Review closure also reads unresolved feedback severities. `major` and `blocker` feedback sends
the task back to Development instead of advancing to Human Review.

## Manual Workflow Transitions

Human gates are intentionally explicit. Use the task transition API when review decides the next
state:

```bash
curl -X POST "${CONTROL_PLANE_BASE_URL}/api/tasks/<task-identifier>/transition" \
  -H "content-type: application/json" \
  -d '{
    "nextState": "Release Version",
    "reason": "Merged build is ready to bind to a release."
  }'
```

Allowed transitions are validated by the state machine:

- Main chain one-step transitions are allowed.
- Any non-terminal state can go to `Done` or `Canceled`.
- Code Review, Human Review, Merged, Released, and Deployed can be sent back to Development.
- Terminal states cannot transition further.

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
- `PLANE_WEBHOOK_SECRET` is configured when exposing `/api/plane/webhook` beyond localhost.
  The receiver verifies Plane `X-Plane-Signature` as HMAC-SHA256 over the raw request body.
- `PLANE_WORKSPACE_SLUG` and `PLANE_PROJECT_ID` are known.
- OpenHands adapter endpoint is verified.
- Langfuse keys are configured.
- `WORKER_MODE=live` has `OPENHANDS_BASE_URL`, `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`; the worker fails fast without them.
- `WORKER_DEFAULT_REPO_CONCURRENCY=1` unless a repo is known safe for parallel edits.
- A database backup exists for the target environment.
- `WORKER_MODE=live` is only enabled after a successful mock run and DB migration.
- `pnpm live:preflight` passes.

## Live Preflight

The live preflight is a non-mutating integration check for the next milestone. It does not create
Plane work items, OpenHands conversations, or Langfuse traces.

```bash
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
PLANE_BASE_URL="https://plane.example" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="..." \
PLANE_API_KEY_HEADER="X-API-Key" \
OPENHANDS_BASE_URL="https://openhands.example" \
LANGFUSE_BASE_URL="https://langfuse.example" \
LANGFUSE_PUBLIC_KEY="..." \
LANGFUSE_SECRET_KEY="..." \
pnpm live:preflight
```

Checks:

- Required live env vars are present.
- PostgreSQL responds to `SELECT 1`.
- Plane work-items API can list one item from the configured project.
- Plane API key auth defaults to `X-API-Key`; set `PLANE_API_KEY_HEADER=Authorization` only for
  bearer-compatible deployments.
- OpenHands health endpoint responds. Default path: `/health`; override with
  `OPENHANDS_HEALTH_PATH`.
- Langfuse health endpoint responds. Default path: `/api/public/health`; override with
  `LANGFUSE_HEALTH_PATH`.

Exit code is `0` only when all checks pass. Use this before starting a live worker and after any
credential, endpoint, or self-host upgrade change.
