#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

pnpm format
pnpm typecheck
DATABASE_URL="" pnpm test
pnpm build
DATABASE_URL="" pnpm worker:dry-run
pnpm --filter @agent-control-plane/db exec prisma migrate status --schema prisma/schema.prisma
pnpm --filter @agent-control-plane/db exec tsx -e 'import { prisma } from "./src/index.ts"; void (async()=>{ const [teams,repos,roles,agents,tasks,runs]=await Promise.all([prisma.team.count(), prisma.repository.count(), prisma.role.count(), prisma.agentDefinition.count(), prisma.task.count(), prisma.run.count()]); console.log(JSON.stringify({teams,repos,roles,agents,tasks,runs})); await prisma.$disconnect(); })();'

if [[ -n "${CONTROL_PLANE_BASE_URL:-}" ]]; then
  scripts/health-check.sh
fi

echo "release-check passed"
