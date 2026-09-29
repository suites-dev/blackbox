#!/usr/bin/env bash

# Packed-consumer acceptance for the native Playwright fixtures. It uses the
# same demo catalog and Compose application as Capsule, but tests only the
# implemented Playwright surface: catalog selection, per-attempt Sandbox,
# request baseURL, raw telemetry, retries, and cleanup.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$E2E_ROOT/.." && pwd)"
RESULT_ROOT="$E2E_ROOT/test-results"
FIXTURE_TOKEN="playwright-e2e-token"
ASSET_ROOT=""
CONSUMER_ROOT=""
INSTRUMENTATION_OWNED=0
RECOVERY_RECORDED=0

PACKAGES=(
  catalog
  instrumentation
  instrumentation-runtime-node
  otel-collector
  playwright
  sandbox
  telemetry
)

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "playwright-test: required command is unavailable: $1" >&2
    exit 1
  }
}

recover_sandboxes() {
  if [[ -n "$CONSUMER_ROOT" && -f "$CONSUMER_ROOT/playwright-evidence.mjs" && -d "$RESULT_ROOT" ]]; then
    if node "$CONSUMER_ROOT/playwright-evidence.mjs" recover "$RESULT_ROOT" \
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
  if [[ "$INSTRUMENTATION_OWNED" -eq 1 ]]; then
    rm -rf "$E2E_ROOT/.blackbox/instrumentation/node_modules"
  fi
  if [[ -n "$ASSET_ROOT" ]]; then
    case "$ASSET_ROOT" in
      "${TMPDIR:-/tmp}"/blackbox-playwright-assets.*) rm -rf "$ASSET_ROOT" ;;
      *)
        echo "playwright-test: refusing to remove unowned asset path: $ASSET_ROOT" >&2
        final_status=1
        ;;
    esac
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
require_command pnpm
docker info >/dev/null

rm -rf "$RESULT_ROOT"
mkdir -p "$RESULT_ROOT"
ASSET_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/blackbox-playwright-assets.XXXXXX")"
PACK_ROOT="$ASSET_ROOT/tarballs"
CONSUMER_ROOT="$ASSET_ROOT/consumer"
mkdir -p "$PACK_ROOT" "$CONSUMER_ROOT"

PNPM_STORE_DIR="$(sed -n 's/^storeDir: //p' "$REPO_ROOT/node_modules/.modules.yaml")"
if [[ -z "$PNPM_STORE_DIR" || ! -d "$PNPM_STORE_DIR" ]]; then
  echo 'playwright-test: cannot locate the installed workspace pnpm store' >&2
  exit 1
fi

cd "$REPO_ROOT"
pnpm build
printf '%s\n' \
  '{"name":"blackbox-playwright-packed-consumer","private":true,"type":"module","dependencies":{"@playwright/test":"1.61.1"},"pnpm":{"overrides":{}}}' \
  >"$CONSUMER_ROOT/package.json"

for package in "${PACKAGES[@]}"; do
  package_directory="$REPO_ROOT/packages/$package"
  package_name="$(jq -er '.name' "$package_directory/package.json")"
  package_version="$(jq -er '.version' "$package_directory/package.json")"
  archive_name="${package_name#@}"
  archive_name="${archive_name/\//-}-$package_version.tgz"
  archive="$PACK_ROOT/$archive_name"
  pnpm --config.ignore-scripts=true --dir "$package_directory" \
    pack --pack-destination "$PACK_ROOT" --silent >/dev/null
  test -s "$archive"
  next_manifest="$CONSUMER_ROOT/package.json.next"
  jq --arg name "$package_name" --arg archive "file:$archive" \
    '.dependencies[$name] = $archive | .pnpm.overrides[$name] = $archive' \
    "$CONSUMER_ROOT/package.json" >"$next_manifest"
  mv "$next_manifest" "$CONSUMER_ROOT/package.json"
done

pnpm --dir "$CONSUMER_ROOT" install --ignore-workspace --prefer-offline --ignore-scripts \
  --store-dir "$PNPM_STORE_DIR"

if [[ ! -d "$E2E_ROOT/.blackbox/instrumentation/node_modules" ]]; then
  INSTRUMENTATION_OWNED=1
  pnpm --dir "$E2E_ROOT/.blackbox/instrumentation" install \
    --ignore-workspace --prod --prefer-offline --ignore-scripts --lockfile=false
fi

mkdir -p "$CONSUMER_ROOT/tests/playwright"
cp "$E2E_ROOT/playwright.config.ts" "$CONSUMER_ROOT/playwright.config.ts"
cp "$E2E_ROOT/tests/playwright/"*.spec.ts "$CONSUMER_ROOT/tests/playwright/"
cp "$SCRIPT_DIR/playwright-evidence.mjs" "$CONSUMER_ROOT/playwright-evidence.mjs"

node "$CONSUMER_ROOT/playwright-evidence.mjs" boundary "$CONSUMER_ROOT" "$REPO_ROOT" \
  >"$RESULT_ROOT/package-boundary.json"

PLAYWRIGHT_BIN="$CONSUMER_ROOT/node_modules/.bin/playwright"
if [[ ! -x "$PLAYWRIGHT_BIN" ]]; then
  echo 'playwright-test: packed consumer did not install Playwright' >&2
  exit 1
fi

cd "$CONSUMER_ROOT"
BLACKBOX_E2E_CONFIG_FILE="$E2E_ROOT/blackbox.config.yaml" \
BLACKBOX_E2E_FIXTURE_TOKEN="$FIXTURE_TOKEN" \
BLACKBOX_E2E_RESULTS_ROOT="$RESULT_ROOT" \
  "$PLAYWRIGHT_BIN" test --config "$CONSUMER_ROOT/playwright.config.ts"

recover_sandboxes
node "$CONSUMER_ROOT/playwright-evidence.mjs" verify "$RESULT_ROOT" \
  >"$RESULT_ROOT/receipt.json"

printf '%s\n' \
  'Playwright journey passed' \
  "packed-consumer=$CONSUMER_ROOT" \
  "artifacts=$RESULT_ROOT"
