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

When `WORKER_MODE=live`, `release:check` also requires a non-empty PostgreSQL custom-format
database backup that `pg_restore --list` can parse. It uses `BACKUP_FILE` when provided, otherwise
the latest `agent-control-plane-*.dump` under `BACKUP_DIR` which defaults to `backups`.

## Health Checks

```bash
CONTROL_PLANE_BASE_URL="http://127.0.0.1:3100" pnpm health
```

The check validates:

- `/api/health`
- `/api/tasks`
- `/api/runs`
- `/api/timeline`
- `/api/audit`
- `/api/monitoring`
- `/api/readiness`
- `/api/prompt-releases`
- `/api/prompt-components`
- `/api/prompt-scopes`

## Operator Timeline And Readiness

The web console exposes two operator-facing surfaces that should be checked before running live
agents:

- `GET /api/timeline` aggregates recent `run_events`, `audit_events`, and `feedback_items`.
  It is the low-noise view for "did an agent claim, run, fail, or complete?"
- `GET /api/audit` and `/audit` expose the dedicated operator audit log. Use `action=<name>`
  and `entityType=<type>` query parameters to inspect task transitions, feedback resolution,
  prompt rollback, and other operator actions with their stored payloads. Audit reads apply
  `AUDIT_LOG_RETENTION_DAYS` by default, support `retentionDays=<days>` overrides up to 3650 days,
  redact sensitive payload keys/secret-like strings, and support `format=csv` exports.
- `GET /api/monitoring` and `/monitoring` expose the production-readiness monitoring surface:
  queue length, run success rate, token/cost volume, and stalled runs.
- `GET /api/readiness` reports Plane, OpenHands, Langfuse, database, and worker configuration
  readiness. When `DATABASE_URL` is configured, it also verifies seeded baseline rows for teams,
  active repositories, roles, and active agent definitions. Missing required live integration
  variables are `missing`; optional or defaulted variables are `warning`.

The dashboard renders both panels. Use them before tailing process logs; logs remain a debug
fallback, not the normal operating surface.

## Worker Heartbeats

Worker heartbeats refresh the local Control Plane run lease while OpenHands is still executing.
They are not written to Plane, so they do not consume Plane API quota.

Default configuration:

```bash
WORKER_LEASE_MS="900000"
WORKER_HEARTBEAT_INTERVAL_MS="30000"
WORKER_LOOP_INTERVAL_MS="60000"
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
- If OpenHands returns a terminal failed or stuck result, the worker marks the run `failed` but still
  records the OpenHands conversation id, UI URL, event cursor, and external events. Failed live runs
  should remain inspectable from Run Detail even when no Langfuse trace was created.

## Worker Workspaces

Each DB-backed run creates one Control Plane `workspace` record before OpenHands execution starts.
The first implementation records the workspace path, marks it `ready`, and passes that path to the
OpenHands conversation request. OpenHands remains responsible for the actual checkout/sandbox
lifecycle.
Run Detail exposes the workspace path, strategy, and status so operators can confirm which local
directory or future sandbox belongs to a run.

Path rule:

- Use repository `local_path` when configured.
- Otherwise use `workspaces/<repo>/runs/<run_id>`.
- Keep `WORKER_DEFAULT_REPO_CONCURRENCY=1` for repos that share a local checkout path.

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

## Runtime Budget Policy

The worker can enforce a coarse cost budget before dispatching tasks.

Default configuration:

```bash
WORKER_COST_BUDGET_LIMIT=""
WORKER_COST_BUDGET_SPENT=""
WORKER_COST_BUDGET_EXCEEDED_ACTION="waiting-approval"
```

Operational rule:

- Estimate task cost with a Plane label such as `cost:1.25` or `estimated-cost:1.25`.
- `WORKER_COST_BUDGET_SPENT + active run reserved cost + estimated task cost` is compared with
  `WORKER_COST_BUDGET_LIMIT`.
- `WORKER_COST_BUDGET_EXCEEDED_ACTION=blocked` moves the task to `Blocked` and writes a
  `task.budget_blocked` audit event.
- The Task Queue shows these tasks as `budget blocked` with lease detail
  `blocked by cost budget policy`, so operators can distinguish budget gates from generic human
  gates.
- `waiting-approval` keeps the task out of the dispatch result without changing state in this first
  version; use `blocked` when the operator needs an explicit visible gate.

## Runtime Concurrency Policy

The live worker and Task Queue both evaluate repo/role concurrency using the same runtime policy
defaults:

```bash
WORKER_DEFAULT_REPO_CONCURRENCY="1"
WORKER_DEFAULT_ROLE_CONCURRENCY="2"
```

Operational rule:

- `repo concurrency` means a task is otherwise dispatchable, but another active run already holds
  the configured repo slot.
- `role concurrency` means the role pool is saturated, so the task waits in queue without changing
  Plane state.
- These gates are shown separately from `gated`, `retry capped`, and `budget blocked` so operators
  can distinguish normal backpressure from human review or failure handling.

## Worker Loop

Use one-shot commands for smoke tests and the loop command for normal worker operation:

```bash
WORKER_MODE="live" pnpm worker:loop
```

The loop dispatches at most one eligible task per iteration, prints the same JSON evidence bundle as
`live:dispatch-once` when work runs, and sleeps for `WORKER_LOOP_INTERVAL_MS` between iterations.
Default interval is `60000` ms.

Operational rule:

- Run `pnpm live:verify-once` before starting the loop in a new environment.
- Keep `PLANE_SYNC_MIN_INTERVAL_MS` at or above `60000` unless Plane rate-limit behavior has been
  revalidated.
- Stop the loop before schema migrations, backup restores, or Plane/OpenHands endpoint upgrades.

## Plane Polling Fallback

The live worker calls Plane sync before each dispatch pass. This is a reconciliation fallback for
missed or incomplete webhooks, not the primary event stream.

Default configuration:

```bash
PLANE_SYNC_MIN_INTERVAL_MS="60000"
PLANE_SYNC_PER_PAGE="100"
```

Operational rule:

- `PLANE_SYNC_MIN_INTERVAL_MS=60000` keeps one worker to at most 60 Plane reconciliation passes per
  hour for fallback polling.
- `PLANE_SYNC_PER_PAGE` is clamped to `1..100`.
- Each reconciliation paginates through Plane cursor pages until there is no `next_cursor`; this
  prevents tasks beyond the first page from being invisible to the live worker.
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

## Plane Task Field Sync

Plane webhook sync and polling fallback both use the same task upsert path. They mirror task
identifier, title, state, repo, priority, assignee, labels, URL, and sync cursor into Control Plane.
This keeps webhook-driven updates and reconciliation-driven updates from drifting.

## Runtime Secret Redaction

Before prompt content is handed to OpenHands or stored as a prompt release snapshot, the worker
redacts common secret shapes from runtime task context and active prompt components: `.env`-style
API key assignments, bearer tokens, OpenAI/GitHub/Slack/AWS token shapes, and private key blocks.
This is a last-mile guardrail, not a secret manager; operators should still avoid putting real
credentials in Plane tasks, comments, workpads, or prompt components.

Run the repository secret gate before release:

```bash
pnpm secrets:check
```

The gate scans tracked text files for high-confidence committed secret patterns such as private key
blocks, OpenAI/GitHub/Slack/AWS token shapes, and long `.env`-style secret assignments. Test files,
build output, dependency directories, lockfiles, and backups are excluded to keep the gate focused on
shipping sources and documentation. `pnpm release:check` runs this gate automatically.

## Prompt Rollback

Use Prompt Manager to compare two prompt component versions before rolling back. Rollback never
edits an existing prompt component or historical prompt release. It creates a new `active` prompt
component version from the selected source version, archives other active versions with the same
scope/name, and records a `prompt.rollback` audit event.

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

Verify the backup gate that live release checks use. This requires PostgreSQL client tools because
the gate runs `pg_restore --list` against the selected custom-format dump:

```bash
BACKUP_FILE="backups/agent-control-plane-YYYYMMDDTHHMMSSZ.dump" scripts/check-backup.sh
```

## Audit Retention And Export

The Audit Log uses the same read API auth as the rest of the dashboard. Configure
`AUDIT_LOG_RETENTION_DAYS` to set the default read window; the API accepts `retentionDays=<days>` for
operator investigations, capped at 3650 days. Payloads are redacted before they leave the server:
sensitive keys such as `token`, `secret`, `apiKey`, `authorization`, `password`, and private-key
fields are replaced with `[REDACTED]`, and common bearer/API-key strings are scrubbed inside string
values.

Export a filtered CSV:

```bash
curl -H "Authorization: Bearer ${CONTROL_PLANE_READ_API_TOKEN:-$CONTROL_PLANE_API_TOKEN}" \
  "${CONTROL_PLANE_BASE_URL}/api/audit?action=task.transition&format=csv" \
  -o audit-log.csv
```

## Linear Migration Plan

Generate an offline migration draft from a Linear JSON or CSV export before creating Plane work
items:

```bash
pnpm linear:migration-plan ./exports/linear-open-issues.json --output ./exports/plane-draft.json
```

Preview the import execution without writing to Plane:

```bash
pnpm linear:migration-plan ./exports/plane-draft.json --apply --dry-run \
  --output ./exports/plane-import-preview.json
```

Apply ready items to Plane after review:

```bash
PLANE_BASE_URL="https://plane.example" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="..." \
pnpm linear:migration-plan ./exports/plane-draft.json --apply \
  --output ./exports/plane-import-result.json
```

The output contains:

- `summary.total`, `summary.ready`, and `summary.missingRepo`.
- One draft per Linear issue with `identifier`, `title`, `description`, `stateName`, `labels`,
  `repo`, `sourceUrl`, and source metadata.
- `blockedReason: "missing-repo"` when the export cannot determine a target repo. These items must
  be fixed before import because the worker requires repo routing.
- `--apply` skips blocked drafts and creates only ready Plane work items. Use `--dry-run` first to
  inspect the exact create/skip plan.
- Before creating a work item, `--apply` paginates through existing Plane work items and treats
  matching `sourceId`, `sourceIdentifier`, or `Migrated from Linear: <identifier>` markers as
  `existing`. This makes rerunning the same import idempotent for already migrated Linear issues.

CSV headers are normalized for common Linear exports, including `id`, `identifier`, `key`, `title`,
`description`, `state`, `status`, `priority`, `labels`, `repo`, `repository`, `project`, `team`,
`assignee`, and `url`.

## Plane Fork

The Plane fork for future self-host customization is:

```text
https://github.com/michaelx1993/plane
```

The first production decision is whether repo routing can be implemented with Plane custom
properties or requires a small Plane schema/UI patch.

## Operator API Access

Set `CONTROL_PLANE_API_TOKEN` before exposing the web console outside localhost. When configured,
operator write APIs require either:

- `Authorization: Bearer <CONTROL_PLANE_API_TOKEN>`
- `X-Control-Plane-Token: <CONTROL_PLANE_API_TOKEN>`

This guards manual transition, retry release, feedback creation, prompt component creation, prompt
binding creation, and prompt rollback routes. Set `CONTROL_PLANE_READ_API_TOKEN` to protect
read-only dashboard APIs with a separate token. If `CONTROL_PLANE_READ_API_TOKEN` is unset, read
APIs fall back to `CONTROL_PLANE_API_TOKEN`; if both are unset, read APIs stay open for local
development. Plane webhook auth is separate and continues to use `PLANE_WEBHOOK_SECRET` plus
`X-Plane-Signature` or the
configured Plane webhook secret header.

The web console includes an `Operator Token` panel on pages that perform protected operations. Paste
the read or operator token there once per browser; the console stores it in browser `localStorage`
and sends it as a bearer token on protected reads and writes. Clear it after using a shared machine.

## Release Gate

Before using the worker against live systems:

- Plane self-host URL and API token are configured.
- `CONTROL_PLANE_API_TOKEN` is configured when the web console is reachable beyond localhost.
- `PLANE_WEBHOOK_SECRET` is configured when exposing `/api/plane/webhook` beyond localhost.
  The receiver verifies Plane `X-Plane-Signature` as HMAC-SHA256 over the raw request body.
- `PLANE_WORKSPACE_SLUG` and `PLANE_PROJECT_ID` are known.
- OpenHands adapter endpoint is verified.
- Langfuse keys are configured.
- `WORKER_MODE=live` has `OPENHANDS_BASE_URL`, `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`; the worker fails fast without them.
- `WORKER_DEFAULT_REPO_CONCURRENCY=1` unless a repo is known safe for parallel edits.
- A database backup exists for the target environment.
- `WORKER_MODE=live` is only enabled after a successful mock run and DB migration.
- Seed baseline data exists for teams, active repositories, roles, and active agent definitions.
- `pnpm release:check` passes; in live mode this includes backup verification and
  `pnpm live:preflight`.

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
OPENHANDS_CONVERSATIONS_PATH="/api/conversations" \
OPENHANDS_RUNS_PATH="/api/runs" \
LANGFUSE_BASE_URL="https://langfuse.example" \
LANGFUSE_TRACES_PATH="/api/public/traces" \
LANGFUSE_GENERATIONS_PATH="/api/public/generations" \
LANGFUSE_PUBLIC_KEY="..." \
LANGFUSE_SECRET_KEY="..." \
pnpm live:preflight
```

Checks:

- Required live env vars are present.
- PostgreSQL responds to `SELECT 1` and has baseline rows for teams, active repositories, roles,
  and active agent definitions. An empty or unseeded Control Plane database fails preflight.
- Plane work-items API can list one item from the configured project.
- Plane API key auth defaults to `X-API-Key`; set `PLANE_API_KEY_HEADER=Authorization` only for
  bearer-compatible deployments.
- OpenHands health endpoint responds. Default path: `/health`; override with
  `OPENHANDS_HEALTH_PATH`.
- OpenHands runtime paths default to `/api/conversations` and `/api/runs`; override with
  `OPENHANDS_CONVERSATIONS_PATH` and `OPENHANDS_RUNS_PATH` if the SDK server differs.
- Langfuse health endpoint responds. Default path: `/api/public/health`; override with
  `LANGFUSE_HEALTH_PATH`.
- Langfuse trace/generation paths default to `/api/public/traces` and `/api/public/generations`;
  override with `LANGFUSE_TRACES_PATH` and `LANGFUSE_GENERATIONS_PATH` if the deployment differs.

Exit code is `0` only when all checks pass. Use this before starting a live worker and after any
credential, endpoint, or self-host upgrade change.

## Container Deployment

The local deployment manifest lives at `infra/docker/docker-compose.yml`.

- Default `docker compose -f infra/docker/docker-compose.yml up -d postgres` still starts only
  PostgreSQL for development.
- `docker compose -f infra/docker/docker-compose.yml --profile app up --build` starts PostgreSQL,
  the Next.js web console, and a long-running worker.
- The web service listens on `3100`.
- The worker service sets `WORKER_RUN_LOOP=true` and dispatches repeatedly with
  `WORKER_LOOP_INTERVAL_MS` between passes.
- Both app services read `../../.env`; the compose file overrides `DATABASE_URL` to use the
  internal `postgres` hostname.
- `pnpm compose:check` validates the app profile with `docker compose config`; `release:check`
  runs the same check when Docker Compose is available.
- `pnpm deploy:compose` runs `pnpm release:check`, starts the `app` profile, then runs `pnpm health`
  against `CONTROL_PLANE_BASE_URL`.
- `BACKUP_FILE=<dump> pnpm rollback:compose` stops web/worker, verifies and restores the selected
  backup, restarts web/worker, then runs `pnpm health`. Use `RESTART_AFTER_ROLLBACK=0` when the
  operator needs to inspect the database before restart.

Before using the `app` profile in live mode, run migrations, seed baseline rows, configure Plane /
OpenHands / Langfuse endpoints in `.env`, then run `pnpm release:check`.

## Operator API Token

Set `CONTROL_PLANE_API_TOKEN` before exposing the web app outside localhost. When configured,
operator write APIs require either `Authorization: Bearer <token>` or `X-Control-Plane-Token:
<token>`.

For browser use, paste the operator token, or the read token for read-only sessions, into the console
`Operator Token` panel before using protected actions. The panel stores the token in browser
`localStorage` and the client attaches it to protected reads and writes.

Protected write paths include:

- prompt component create / rollback
- prompt binding create
- run feedback create
- task retry release
- manual task transition

Read-only dashboard APIs remain open in this first personal-ops version.

The Task Queue supports read-only filtering in both the dashboard and `GET /api/tasks`:
`team=<key>`, `project=<slug>`, `repo=<slug>`, and `state=<display-state>`. The dashboard uses the
same query parameters, so filtered views can be shared by URL.

The Task Queue table exposes manual task transitions for operator gates. It offers the next main
workflow state, rework back to `Development` where the state machine allows it, `Blocked`, `Done`,
and `Canceled`. The API still validates every requested transition with the shared state machine.

Run Detail exposes `Resolve` on unresolved feedback items. Use it after the feedback has been
handled; resolved feedback remains visible in the run history but is no longer injected as unresolved
Development rework context.

Run Detail also exposes `Progress / Workpad`. The progress list is derived from Control Plane run
events, including claimed/running heartbeat, OpenHands external events, state sync, and terminal
events. The workpad snapshot summarizes current state, suggested next state, latest progress, open
feedback count, workspace path, and result/failure summary for fast operator triage.

## Plane API Probe

Use the Plane probe during the self-host spike after `live:preflight` proves basic connectivity.
By default it is non-mutating: it lists work items, loads a probe task, and verifies repo routing can
be parsed from structured fields or `repo:<name>` labels.

```bash
PLANE_BASE_URL="https://plane.example" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="..." \
PLANE_PROBE_TASK_ID="task-id-from-plane" \
pnpm plane:probe
```

To explicitly verify PATCH and comment APIs, opt into mutation against a disposable spike task:

```bash
PLANE_PROBE_MUTATE="true" \
PLANE_PROBE_TASK_ID="task-id-from-plane" \
PLANE_PROBE_PATCH_JSON='{"labels":["repo:crs-src","control-plane-probe"]}' \
PLANE_PROBE_COMMENT_BODY="Agent Control Plane probe" \
pnpm plane:probe
```

The probe fails if listing, repo parsing, task load, PATCH, or comment checks fail. Keep the mutating
probe pointed at a disposable spike work item.

## Live Dispatch Smoke Test

After `release:check` and `live:preflight` pass, run exactly one live dispatch to validate the
Plane -> Control Plane -> OpenHands -> Langfuse -> Plane loop:

```bash
WORKER_MODE="live" \
DATABASE_URL="postgresql://agent:agent@localhost:54329/agent_control_plane?schema=public" \
PLANE_BASE_URL="https://plane.example" \
PLANE_WORKSPACE_SLUG="workspace" \
PLANE_PROJECT_ID="project" \
PLANE_API_KEY="..." \
OPENHANDS_BASE_URL="https://openhands.example" \
LANGFUSE_BASE_URL="https://langfuse.example" \
LANGFUSE_PUBLIC_KEY="..." \
LANGFUSE_SECRET_KEY="..." \
pnpm live:verify-once
```

The script refuses to run unless `WORKER_MODE=live`, runs `pnpm live:preflight`, dispatches one
eligible task, then validates the smoke-test evidence bundle. Use `pnpm live:dispatch-once` when you
need the raw dispatch JSON without the verifier.

- `task`: Control Plane task id, Plane task id, title, team/project/repo, and post-dispatch state.
- `run`: run id, status, role, attempt, prompt release id, workspace path, OpenHands conversation
  id/url, Langfuse trace id/url, next state, summary, and error if present.
- `verification`: `/runs/<run_id>`, Plane task id, OpenHands evidence, Langfuse evidence, and the
  expected next state.

The verifier fails if the run evidence is missing Run Detail, Plane, workspace, OpenHands, or
Langfuse handles.

Verify the Run Detail workspace metadata, OpenHands conversation, Langfuse trace, and Plane status
comment before enabling a long-running worker.
