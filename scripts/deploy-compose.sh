#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/lib/secret-env.sh
source "$ROOT_DIR/scripts/lib/secret-env.sh"

ACP_IMAGE="${ACP_IMAGE:-michaelxxx/agent-control-plane:0.0.1}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-agent-control-plane}"
ENABLE_WORKER="${ENABLE_WORKER:-true}"
SKIP_PULL="${SKIP_PULL:-false}"
DRY_RUN="${DEPLOY_COMPOSE_DRY_RUN:-false}"

export ACP_IMAGE COMPOSE_PROJECT_NAME

load_secret_env_file() {
  local file="${ACP_SECRET_ENV_FILE:-}"
  if [[ -z "$file" ]]; then
    return
  fi

  if [[ ! -f "$file" ]]; then
    echo "secret_env_file_not_found=${file}" >&2
    exit 1
  fi

  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || printf '')"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    echo "secret_env_file_permissions=${mode}" >&2
    exit 1
  fi

  if ! load_dotenv_file_safe "$file"; then
    echo "secret_env_file_invalid=true" >&2
    exit 1
  fi
}

load_secret_command() {
  local command="${ACP_SECRET_COMMAND:-}"
  if [[ -z "$command" ]]; then
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! bash -c "$command" >"$tmp_file"; then
    rm -f "$tmp_file"
    echo "secret_command_failed=true" >&2
    exit 1
  fi

  chmod 600 "$tmp_file"
  if ! load_dotenv_file_safe "$tmp_file"; then
    echo "secret_command_invalid_dotenv=true" >&2
    exit 1
  fi
  rm -f "$tmp_file"
}

load_secret_env_file
load_secret_command

if [[ "$DRY_RUN" == "true" ]]; then
  docker compose config >/dev/null
  cat <<EOF
deploy_compose=dry_run
deployed_image=${ACP_IMAGE}
compose_project=${COMPOSE_PROJECT_NAME}
worker_enabled=${ENABLE_WORKER}
EOF
  exit 0
fi

echo "==> validating secrets"
bash scripts/validate-secrets.sh

if [[ "$SKIP_PULL" != "true" ]]; then
  echo "==> pulling ${ACP_IMAGE}"
  docker compose pull web migrate worker || true
fi

echo "==> starting postgres"
docker compose up -d postgres

echo "==> running migrations"
docker compose run --rm migrate

echo "==> deploying web with ${ACP_IMAGE}"
docker compose up -d --no-build web

if [[ "$ENABLE_WORKER" == "true" ]]; then
  echo "==> deploying worker with ${ACP_IMAGE}"
  docker compose --profile worker up -d --no-build worker
fi

echo "==> checking readiness"
curl -fsS "${READINESS_URL:-http://127.0.0.1:3112/api/readiness}" >/dev/null

cat <<EOF
deployed_image=${ACP_IMAGE}
compose_project=${COMPOSE_PROJECT_NAME}
worker_enabled=${ENABLE_WORKER}
EOF
