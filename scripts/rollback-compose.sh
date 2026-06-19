#!/usr/bin/env bash
set -euo pipefail

compose_file="${COMPOSE_FILE:-infra/docker/docker-compose.yml}"
base_url="${CONTROL_PLANE_BASE_URL:-http://127.0.0.1:3100}"

run() {
  if [[ "${DRY_RUN:-}" == "1" ]]; then
    printf 'dry-run:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

run docker compose -f "${compose_file}" --profile app stop web worker

if [[ -n "${BACKUP_FILE:-}" ]]; then
  run scripts/check-backup.sh
  run scripts/db-restore.sh "${BACKUP_FILE}"
fi

if [[ "${RESTART_AFTER_ROLLBACK:-1}" == "1" ]]; then
  run docker compose -f "${compose_file}" --profile app up -d web worker
  if [[ "${SKIP_HEALTH_CHECK:-}" != "1" ]]; then
    run env CONTROL_PLANE_BASE_URL="${base_url}" pnpm health
  fi
fi

echo "rollback-compose completed for ${base_url}"
