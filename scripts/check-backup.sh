#!/usr/bin/env bash
set -euo pipefail

backup_file="${BACKUP_FILE:-}"
if [[ -z "${backup_file}" ]]; then
  backup_dir="${BACKUP_DIR:-backups}"
  backup_file="$(find "${backup_dir}" -maxdepth 1 -type f -name 'agent-control-plane-*.dump' -print 2>/dev/null | sort | tail -n 1 || true)"
fi

if [[ -z "${backup_file}" || ! -s "${backup_file}" ]]; then
  echo "A non-empty database backup is required. Set BACKUP_FILE or create one with scripts/db-backup.sh." >&2
  exit 1
fi

echo "using database backup ${backup_file}"
