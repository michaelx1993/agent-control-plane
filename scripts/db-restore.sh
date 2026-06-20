#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
BACKUP_PATH="${BACKUP_PATH:-}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-}"
STOP_WORKER="${STOP_WORKER:-true}"
RUN_READINESS_CHECK="${RUN_READINESS_CHECK:-true}"
READINESS_URL="${READINESS_URL:-http://127.0.0.1:3112/api/readiness}"

check_sha256() {
  local checksum_path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check "$checksum_path"
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 --check "$checksum_path"
    return
  fi

  echo "sha256sum or shasum is required to verify backup checksums." >&2
  exit 127
}

if [[ -z "$BACKUP_PATH" ]]; then
  echo "BACKUP_PATH is required, for example: BACKUP_PATH=backups/agent-control-plane-20260619T120000Z.dump" >&2
  exit 2
fi

if [[ "$CONFIRM_RESTORE" != "restore-agent-control-plane" ]]; then
  echo "Refusing to restore database without CONFIRM_RESTORE=restore-agent-control-plane" >&2
  exit 2
fi

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Backup file not found: ${BACKUP_PATH}" >&2
  exit 2
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required. Install PostgreSQL client tools before running database restore." >&2
  exit 127
fi

if [[ -f "${BACKUP_PATH}.sha256" ]]; then
  echo "==> verifying checksum"
  check_sha256 "${BACKUP_PATH}.sha256"
fi

if [[ "$STOP_WORKER" == "true" ]]; then
  echo "==> stopping worker before restore"
  docker compose --profile worker stop worker || true
fi

echo "==> restoring ${BACKUP_PATH} into ${DATABASE_URL}"
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$DATABASE_URL" \
  "$BACKUP_PATH"

if [[ "$RUN_READINESS_CHECK" == "true" ]]; then
  echo "==> checking readiness"
  curl -fsS "$READINESS_URL" >/dev/null
fi

cat <<EOF
restored_backup=${BACKUP_PATH}
database_url=${DATABASE_URL}
worker_stopped=${STOP_WORKER}
readiness_checked=${RUN_READINESS_CHECK}
EOF
