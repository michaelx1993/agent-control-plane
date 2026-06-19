#!/usr/bin/env bash
set -euo pipefail

backup_file="${BACKUP_FILE:-}"
if [[ -z "${backup_file}" ]]; then
  backup_dir="${BACKUP_DIR:-backups}"
  backup_file="$(find "${backup_dir}" -maxdepth 1 -type f -name 'agent-control-plane-*.dump' -print 2>/dev/null | sort | tail -n 1 || true)"
fi

if [[ -z "${backup_file}" ]]; then
  echo "BACKUP_FILE is required, or create a backup under BACKUP_DIR with scripts/db-backup.sh." >&2
  exit 1
fi

if [[ -z "${RESTORE_DRILL_DATABASE_URL:-}" ]]; then
  echo "RESTORE_DRILL_DATABASE_URL is required and must point at a disposable drill database." >&2
  exit 1
fi

if [[ -n "${DATABASE_URL:-}" && "${RESTORE_DRILL_DATABASE_URL}" == "${DATABASE_URL}" ]]; then
  echo "RESTORE_DRILL_DATABASE_URL must not equal DATABASE_URL." >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required for restore drills; install PostgreSQL client tools." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for restore drills; install PostgreSQL client tools." >&2
  exit 1
fi

scripts/check-backup.sh

pg_restore "${backup_file}" \
  --dbname="${RESTORE_DRILL_DATABASE_URL}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges

baseline="$(
  psql "${RESTORE_DRILL_DATABASE_URL}" -At -F ',' -c "
    SELECT
      (SELECT COUNT(*) FROM teams),
      (SELECT COUNT(*) FROM repositories WHERE status = 'active'),
      (SELECT COUNT(*) FROM roles),
      (SELECT COUNT(*) FROM agent_definitions WHERE status = 'active');
  "
)"

IFS=',' read -r teams repositories roles agents <<<"${baseline}"

if [[ "${teams:-0}" -le 0 || "${repositories:-0}" -le 0 || "${roles:-0}" -le 0 || "${agents:-0}" -le 0 ]]; then
  echo "restore drill failed baseline check: teams=${teams:-0}, repositories=${repositories:-0}, roles=${roles:-0}, agents=${agents:-0}" >&2
  exit 1
fi

echo "restore drill passed for ${backup_file}: teams=${teams}, repositories=${repositories}, roles=${roles}, agents=${agents}"
