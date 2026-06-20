#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-agent-control-plane}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}"
IMAGE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
LATEST_IMAGE="${IMAGE_REPOSITORY}:latest"

if [[ "${RELEASE_IMAGE_SKIP_VALIDATION:-false}" != "true" ]]; then
  echo "==> validating release gate"
  pnpm format
  pnpm check
  pnpm build
fi

echo "==> building ${IMAGE}"
docker build \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "$IMAGE" \
  -t "$LATEST_IMAGE" \
  .

if [[ "${PUSH_IMAGE:-false}" == "true" ]]; then
  echo "==> pushing ${IMAGE}"
  docker push "$IMAGE"
  docker push "$LATEST_IMAGE"
fi

cat <<EOF
release_image=${IMAGE}
latest_image=${LATEST_IMAGE}
revision=$(git rev-parse HEAD)
EOF
