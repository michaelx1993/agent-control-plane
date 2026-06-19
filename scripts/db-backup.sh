#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-backups}"
mkdir -p "${BACKUP_DIR}"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
target="${BACKUP_DIR}/agent-control-plane-${timestamp}.dump"

pg_dump "${DATABASE_URL}" --format=custom --no-owner --no-privileges --file="${target}"

echo "${target}"
