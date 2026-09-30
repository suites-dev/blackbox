#!/usr/bin/env bash

# Registry-consumer acceptance for the native Playwright fixtures. The caller
# prepares the disposable consumer first. This script materializes the same
# config, catalog, SUT, and tests a user repository would own, then installs
# project instrumentation and runs every test in its own Sandbox.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
E2E_ROOT="$REPO_ROOT/e2e"
RESULT_ROOT="$E2E_ROOT/test-results"
STATE_FILE="$E2E_ROOT/.blackbox/capsule-assets.json"
FIXTURE_TOKEN="playwright-e2e-token"
ASSET_ROOT=""
CONSUMER_ROOT=""
BLACKBOX_BIN=""
RECOVERY_RECORDED=0

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "playwright-test: required command is unavailable: $1" >&2
    exit 1
  }
}

recover_sandboxes() {
  if [[ -d "$RESULT_ROOT" && -n "$CONSUMER_ROOT" && -d "$CONSUMER_ROOT" ]]; then
    if node "$SCRIPT_DIR/playwright-recover.mjs" "$RESULT_ROOT" "$CONSUMER_ROOT" \
      >"$RESULT_ROOT/recovery.json"; then
      RECOVERY_RECORDED=1
    else
      return 1
    fi
  fi
}

cleanup() {
  local original_status=$?
  local final_status=$original_status
  trap - EXIT INT TERM

  if [[ "$RECOVERY_RECORDED" -eq 0 ]] && ! recover_sandboxes; then
    echo 'playwright-test: interrupted Sandbox recovery failed' >&2
    final_status=1
  fi
  if ! node "$REPO_ROOT/scripts/consumer/capsule-asset-cleanup.mjs"; then
    echo 'playwright-test: registry consumer cleanup failed' >&2
    final_status=1
  fi
  echo "playwright-test: artifacts retained at $RESULT_ROOT" >&2
  exit "$final_status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command docker
require_command jq
require_command node
docker info >/dev/null

rm -rf "$RESULT_ROOT"
mkdir -p "$RESULT_ROOT"

if [[ ! -f "$STATE_FILE" ]]; then
  echo 'playwright-test: registry consumer is not prepared; run pnpm prepare:consumer' >&2
  exit 1
fi

ASSET_ROOT="$(jq -er '.assetRoot' "$STATE_FILE")"
CONSUMER_ROOT="$(jq -er '.consumerRoot' "$STATE_FILE")"
BLACKBOX_BIN="$(jq -er '.blackboxBin' "$STATE_FILE")"
TEMP_ROOT="$(cd -- "${TMPDIR:-/tmp}" && pwd)"
ASSET_PARENT="$(cd -- "$(dirname -- "$ASSET_ROOT")" && pwd)"
ASSET_NAME="$(basename -- "$ASSET_ROOT")"
[[ "$ASSET_PARENT" == "$TEMP_ROOT" && "$ASSET_NAME" =~ ^blackbox-capsule-assets\.[A-Za-z0-9]+$ ]] || {
  echo "playwright-test: refusing unowned asset root: $ASSET_ROOT" >&2
  exit 1
}
[[ "$CONSUMER_ROOT" == "$ASSET_ROOT/consumer" ]] || {
  echo 'playwright-test: consumer does not belong to the prepared asset root' >&2
  exit 1
}
[[ "$BLACKBOX_BIN" == "$CONSUMER_ROOT/node_modules/.bin/blackbox" && -x "$BLACKBOX_BIN" ]] || {
  echo 'playwright-test: prepared consumer does not expose the Blackbox CLI' >&2
  exit 1
}

mkdir -p "$CONSUMER_ROOT/.blackbox/catalog" "$CONSUMER_ROOT/.blackbox/drivers"
mkdir -p "$CONSUMER_ROOT/tests/playwright"
cp "$E2E_ROOT/blackbox.config.yaml" "$CONSUMER_ROOT/blackbox.config.yaml"
cp "$E2E_ROOT/.blackbox/catalog/"*.yml "$CONSUMER_ROOT/.blackbox/catalog/"
cp "$E2E_ROOT/.blackbox/drivers/"*.mjs "$CONSUMER_ROOT/.blackbox/drivers/"
cp -R "$E2E_ROOT/sut" "$CONSUMER_ROOT/sut"
cp "$E2E_ROOT/playwright.config.ts" "$CONSUMER_ROOT/playwright.config.ts"
cp "$E2E_ROOT/tests/playwright/"*.ts "$CONSUMER_ROOT/tests/playwright/"
cp "$SCRIPT_DIR/playwright-boundary.mjs" "$CONSUMER_ROOT/playwright-boundary.mjs"
cp "$SCRIPT_DIR/playwright-evidence.mjs" "$CONSUMER_ROOT/playwright-evidence.mjs"

cd "$CONSUMER_ROOT"
NPM_CONFIG_REGISTRY="${BLACKBOX_TEST_REGISTRY:-http://127.0.0.1:4874/}" \
NPM_CONFIG_CACHE="$ASSET_ROOT/npm-cache" \
  "$BLACKBOX_BIN" inst install --runtime node \
  >"$RESULT_ROOT/instrumentation-install.txt"
test -s "$CONSUMER_ROOT/.blackbox/instrumentation/instrumentation.js"
test -d "$CONSUMER_ROOT/.blackbox/instrumentation/node_modules"

"$BLACKBOX_BIN" catalog validate --json >"$RESULT_ROOT/catalog-validate.json"
jq -e '.ok == true' "$RESULT_ROOT/catalog-validate.json" >/dev/null
"$BLACKBOX_BIN" catalog ls --json >"$RESULT_ROOT/catalog.json"
jq -e '
  (.entries | any(.id == "subscription-system" and .kind == "system")) and
  (.entries | any(.id == "payment-mock" and .kind == "subsystem"))
' "$RESULT_ROOT/catalog.json" >/dev/null

node "$CONSUMER_ROOT/playwright-boundary.mjs" >"$RESULT_ROOT/package-boundary.json"

PLAYWRIGHT_BIN="$CONSUMER_ROOT/node_modules/.bin/playwright"
if [[ ! -x "$PLAYWRIGHT_BIN" ]]; then
  echo 'playwright-test: registry consumer did not install Playwright' >&2
  exit 1
fi

BLACKBOX_E2E_FIXTURE_TOKEN="$FIXTURE_TOKEN" \
BLACKBOX_E2E_RESULTS_ROOT="$RESULT_ROOT" \
  "$PLAYWRIGHT_BIN" test --config "$CONSUMER_ROOT/playwright.config.ts"

recover_sandboxes
node "$SCRIPT_DIR/playwright-verify.mjs" "$RESULT_ROOT" >"$RESULT_ROOT/receipt.json"

printf '%s\n' \
  'Playwright journey passed' \
  "registry-consumer=$CONSUMER_ROOT" \
  "artifacts=$RESULT_ROOT"
