#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acp-doc-script-parity-smoke.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

OUTPUT_FILE="$TMP_DIR/doc-script-parity.out"
BAD_PACKAGE_FILE="$TMP_DIR/package.json"
BAD_DOC_FILE="$TMP_DIR/docs.md"
BAD_LOCAL_SMOKE_FILE="$TMP_DIR/local-completion-smoke.sh"
BAD_OUTPUT_FILE="$TMP_DIR/doc-script-parity-negative.out"

pnpm --silent doc-script-parity >"$OUTPUT_FILE"

if ! grep -q '^doc_script_parity=passed$' "$OUTPUT_FILE"; then
  echo "doc_script_parity_smoke=failed" >&2
  echo "error=positive parity check did not pass" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

cat >"$BAD_PACKAGE_FILE" <<'JSON'
{
  "scripts": {
    "completion:missing-doc": "bash scripts/missing-doc.sh"
  }
}
JSON

cat >"$BAD_DOC_FILE" <<'EOF'
This fixture documents git diff --check only.
EOF

cat >"$BAD_LOCAL_SMOKE_FILE" <<'EOF'
run_step "git_diff_check" git diff --check
EOF

if env \
  ACP_DOC_SCRIPT_PARITY_PACKAGE_FILE="$BAD_PACKAGE_FILE" \
  ACP_DOC_SCRIPT_PARITY_DOC_FILES="$BAD_DOC_FILE" \
  ACP_DOC_SCRIPT_PARITY_LOCAL_DOC_FILES="$BAD_DOC_FILE" \
  ACP_DOC_SCRIPT_PARITY_LOCAL_SMOKE_FILE="$BAD_LOCAL_SMOKE_FILE" \
  node scripts/check-doc-script-parity.mjs >"$BAD_OUTPUT_FILE" 2>&1; then
  echo "doc_script_parity_smoke=failed" >&2
  echo "error=negative fixture unexpectedly passed" >&2
  cat "$BAD_OUTPUT_FILE" >&2
  exit 1
fi

if ! grep -q 'completion:missing-doc' "$BAD_OUTPUT_FILE"; then
  echo "doc_script_parity_smoke=failed" >&2
  echo "error=negative fixture did not report missing package script docs" >&2
  cat "$BAD_OUTPUT_FILE" >&2
  exit 1
fi

echo "doc_script_parity_smoke=passed"
