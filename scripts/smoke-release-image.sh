#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat >"$TMP_DIR/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${DOCKER_SMOKE_LOG:?}"
DOCKER
chmod +x "$TMP_DIR/docker"

if ! grep -Eq '^COPY[[:space:]]+scripts[[:space:]]+./scripts' "$ROOT_DIR/Dockerfile"; then
  echo "smoke-release-image: Dockerfile must copy scripts into the runtime image" >&2
  exit 1
fi

run_release() {
  local log_file="$1"
  shift

  : >"$log_file"
  (
    cd "$ROOT_DIR"
    PATH="$TMP_DIR:$PATH" \
      DOCKER_SMOKE_LOG="$log_file" \
      IMAGE_REPOSITORY="smoke/agent-control-plane" \
      IMAGE_TAG="smoke" \
      RELEASE_IMAGE_SKIP_VALIDATION="true" \
      "$@" bash scripts/release-image.sh >/dev/null
  )
}

require_log() {
  local pattern="$1"
  local log_file="$2"

  if ! grep -Fq -- "$pattern" "$log_file"; then
    echo "smoke-release-image: missing docker argument: $pattern" >&2
    echo "docker log:" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

legacy_log="$TMP_DIR/legacy.log"
run_release "$legacy_log" env
require_log "build --label" "$legacy_log"
require_log "-t smoke/agent-control-plane:smoke" "$legacy_log"
require_log "-t smoke/agent-control-plane:latest" "$legacy_log"

single_platform_log="$TMP_DIR/single-platform.log"
run_release "$single_platform_log" env RELEASE_IMAGE_PLATFORMS=linux/arm64
require_log "buildx build --platform linux/arm64" "$single_platform_log"
require_log "--load" "$single_platform_log"

multi_platform_log="$TMP_DIR/multi-platform.log"
run_release "$multi_platform_log" env RELEASE_IMAGE_PLATFORMS=linux/amd64,linux/arm64 PUSH_IMAGE=true
require_log "buildx build --platform linux/amd64,linux/arm64" "$multi_platform_log"
require_log "--push" "$multi_platform_log"

if run_release "$TMP_DIR/multi-platform-no-push.log" env RELEASE_IMAGE_PLATFORMS=linux/amd64,linux/arm64; then
  echo "smoke-release-image: multi-platform build without push should fail" >&2
  exit 1
fi

echo "smoke-release-image: ok"
