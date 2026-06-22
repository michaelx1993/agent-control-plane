#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-agent-control-plane}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}"
IMAGE_PLATFORMS="${RELEASE_IMAGE_PLATFORMS:-}"
IMAGE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
LATEST_IMAGE="${IMAGE_REPOSITORY}:latest"

if [[ "${RELEASE_IMAGE_SKIP_VALIDATION:-false}" != "true" ]]; then
  echo "==> validating release gate"
  pnpm format
  pnpm check
  pnpm build
fi

echo "==> building ${IMAGE}"
if [[ -n "$IMAGE_PLATFORMS" ]]; then
  build_args=(
    buildx build
    --platform "$IMAGE_PLATFORMS"
    --label "org.opencontainers.image.revision=$(git rev-parse HEAD)"
    --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    -t "$IMAGE"
    -t "$LATEST_IMAGE"
  )

  if [[ "${PUSH_IMAGE:-false}" == "true" ]]; then
    echo "==> pushing ${IMAGE} for ${IMAGE_PLATFORMS}"
    build_args+=(--push)
  elif [[ "$IMAGE_PLATFORMS" == *,* ]]; then
    echo "release-image: multi-platform builds require PUSH_IMAGE=true" >&2
    exit 1
  else
    build_args+=(--load)
  fi

  docker "${build_args[@]}" .
else
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
fi

cat <<EOF
release_image=${IMAGE}
latest_image=${LATEST_IMAGE}
platforms=${IMAGE_PLATFORMS:-local}
revision=$(git rev-parse HEAD)
EOF
