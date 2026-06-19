#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed; skipping compose config check"
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is not available; skipping compose config check"
  exit 0
fi

docker compose -f infra/docker/docker-compose.yml --profile app config >/tmp/agent-control-plane-compose.yml
echo "compose-check passed"
