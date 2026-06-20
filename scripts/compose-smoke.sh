#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ACP_COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"

if ! command -v docker >/dev/null 2>&1; then
  echo "compose_smoke=skipped reason=docker_not_found"
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "compose_smoke=skipped reason=docker_compose_not_found"
  exit 0
fi

config_output="$(docker compose -f "$COMPOSE_FILE" config)"

for service in postgres migrate web; do
  if ! grep -q "^  ${service}:" <<<"$config_output"; then
    echo "compose_smoke=failed reason=missing_${service}_service" >&2
    exit 1
  fi
done

if ! grep -q "DATABASE_URL" <<<"$config_output"; then
  echo "compose_smoke=failed reason=missing_database_url" >&2
  exit 1
fi

echo "compose_smoke=passed"
