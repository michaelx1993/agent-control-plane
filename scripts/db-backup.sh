#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATABASE_URL="${DATABASE_URL:-postgresql://agent:agent@localhost:54329/agent_control_plane}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
BACKUP_NAME="${BACKUP_NAME:-agent-control-plane-$(date -u +%Y%m%dT%H%M%SZ).dump}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

write_sha256() {
  local path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path"
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path"
    return
  fi

  echo "sha256sum or shasum is required to write backup checksums." >&2
  exit 127
}

mkdir -p "$BACKUP_DIR"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required. Install PostgreSQL client tools before running database backup." >&2
  exit 127
fi

echo "==> backing up database to ${BACKUP_PATH}"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$BACKUP_PATH" \
  "$DATABASE_URL"

write_sha256 "$BACKUP_PATH" >"${BACKUP_PATH}.sha256"

cat <<EOF
backup_path=${BACKUP_PATH}
checksum_path=${BACKUP_PATH}.sha256
database_url=${DATABASE_URL}
EOF
