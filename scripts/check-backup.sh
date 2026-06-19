#!/usr/bin/env bash
set -euo pipefail

backup_file="${BACKUP_FILE:-}"
if [[ -z "${backup_file}" ]]; then
  backup_dir="${BACKUP_DIR:-backups}"
  backup_file="$(find "${backup_dir}" -maxdepth 1 -type f -name 'agent-control-plane-*.dump' -print 2>/dev/null | sort | tail -n 1 || true)"
fi

if [[ -z "${backup_file}" || ! -s "${backup_file}" ]]; then
  echo "A non-empty PostgreSQL custom-format database backup is required. Set BACKUP_FILE or create one with scripts/db-backup.sh." >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required to verify ${backup_file}; install PostgreSQL client tools before live release." >&2
  exit 1
fi

list_file="$(mktemp)"
error_file="$(mktemp)"
trap 'rm -f "${list_file}" "${error_file}"' EXIT

if ! pg_restore --list "${backup_file}" >"${list_file}" 2>"${error_file}"; then
  echo "Backup ${backup_file} is not a valid PostgreSQL custom-format dump." >&2
  cat "${error_file}" >&2
  exit 1
fi

if [[ ! -s "${list_file}" ]]; then
  echo "Backup ${backup_file} has an empty pg_restore manifest." >&2
  exit 1
fi

echo "using verified database backup ${backup_file}"
