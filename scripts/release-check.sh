#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

if [[ "${WORKER_MODE:-}" == "live" ]]; then
  if [[ "${REQUIRE_RUNTIME_PROBE:-}" == "1" && "${RUNTIME_PROBE_MUTATE:-}" != "true" ]]; then
    echo "REQUIRE_RUNTIME_PROBE=1 requires RUNTIME_PROBE_MUTATE=true because runtime:probe creates OpenHands and Langfuse records." >&2
    exit 1
  fi
  scripts/check-backup.sh
  if [[ "${REQUIRE_RESTORE_DRILL:-}" == "1" ]]; then
    scripts/restore-drill.sh
  fi
fi

pnpm format
pnpm typecheck
pnpm secrets:check
DATABASE_URL="" pnpm test
pnpm build
scripts/compose-check.sh
DATABASE_URL="" pnpm worker:dry-run
pnpm --filter @agent-control-plane/db exec prisma migrate status --schema prisma/schema.prisma
pnpm --filter @agent-control-plane/db exec tsx -e 'import { prisma } from "./src/index.ts"; void (async()=>{ const [teams,repos,roles,agents,tasks,runs]=await Promise.all([prisma.team.count(), prisma.repository.count(), prisma.role.count(), prisma.agentDefinition.count(), prisma.task.count(), prisma.run.count()]); console.log(JSON.stringify({teams,repos,roles,agents,tasks,runs})); await prisma.$disconnect(); })();'

if [[ -n "${CONTROL_PLANE_BASE_URL:-}" ]]; then
  scripts/health-check.sh
fi

if [[ "${WORKER_MODE:-}" == "live" ]]; then
  pnpm live:preflight
  if [[ "${REQUIRE_RUNTIME_PROBE:-}" == "1" ]]; then
    pnpm runtime:probe
  else
    echo "runtime protocol probe skipped; set REQUIRE_RUNTIME_PROBE=1 and RUNTIME_PROBE_MUTATE=true to include it in live release-check"
  fi
fi

echo "release-check passed"
