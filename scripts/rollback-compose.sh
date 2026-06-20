#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${ROLLBACK_IMAGE:-}" ]]; then
  echo "ROLLBACK_IMAGE is required, for example: ROLLBACK_IMAGE=agent-control-plane:<previous-sha>" >&2
  exit 2
fi

ACP_IMAGE="$ROLLBACK_IMAGE"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-agent-control-plane}"
ENABLE_WORKER="${ENABLE_WORKER:-true}"
SKIP_PULL="${SKIP_PULL:-false}"

export ACP_IMAGE COMPOSE_PROJECT_NAME

if [[ "$SKIP_PULL" != "true" ]]; then
  echo "==> pulling rollback image ${ACP_IMAGE}"
  docker compose pull web worker || true
fi

echo "==> rolling back web to ${ACP_IMAGE}"
docker compose up -d --no-build web

if [[ "$ENABLE_WORKER" == "true" ]]; then
  echo "==> rolling back worker to ${ACP_IMAGE}"
  docker compose --profile worker up -d --no-build worker
fi

echo "==> checking readiness"
curl -fsS "${READINESS_URL:-http://127.0.0.1:3112/api/readiness}" >/dev/null

cat <<EOF
rollback_image=${ACP_IMAGE}
compose_project=${COMPOSE_PROJECT_NAME}
worker_enabled=${ENABLE_WORKER}
database_rollback=not_performed
EOF
