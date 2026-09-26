#!/usr/bin/env bash

# Prepare the assets consumed by capsule-test.sh. This script does not acquire
# Docker resources or start a Capsule. It packs Phase 1 packages, installs them
# into an external consumer, and installs the packed Driver SDK beside the
# project-authored drivers.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$E2E_ROOT/.." && pwd)"
STATE_FILE="$E2E_ROOT/.blackbox/capsule-assets.json"
DRIVER_DIRECTORY="$E2E_ROOT/.blackbox/drivers"
PHASE_ONE_PACKAGES=(
  capsule
  catalog
  cli
  driver
  instrumentation
  instrumentation-runtime-node
  otel-collector
  report-server
  sandbox
  telemetry
)

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_CYAN=$'\033[36m'; C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
  C_RESET=''; C_CYAN=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "capsule-assets: required command is unavailable: $1" >&2
    exit 1
  }
}

require_command pnpm
require_command jq
require_command node

PNPM_STORE_DIR="$(sed -n 's/^storeDir: //p' "$REPO_ROOT/node_modules/.modules.yaml")"
if [[ -z "$PNPM_STORE_DIR" || ! -d "$PNPM_STORE_DIR" ]]; then
  echo 'capsule-assets: cannot locate the store backing the installed workspace dependencies' >&2
  exit 1
fi

# A killed earlier run can leave its external consumer behind. The state file
# is accepted only when the cleanup helper proves the path belongs to this test.
node "$SCRIPT_DIR/capsule-asset-boundary.mjs" cleanup

ASSET_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/blackbox-capsule-assets.XXXXXX")"
PACK_ROOT="$ASSET_ROOT/tarballs"
CONSUMER_ROOT="$ASSET_ROOT/consumer"
ARTIFACT_ROOT="$E2E_ROOT/.blackbox/tmp/capsule-assets"
mkdir -p "$PACK_ROOT" "$CONSUMER_ROOT"
ASSETS_READY=0

cleanup_failed_preparation() {
  local status=$?
  trap - EXIT
  if [[ "$ASSETS_READY" -eq 0 ]]; then
    rm -rf "$ASSET_ROOT"
  fi
  exit "$status"
}
trap cleanup_failed_preparation EXIT

cd "$REPO_ROOT"
printf '%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$C_BLUE" "$C_RESET"
printf '%s[blackbox]%s %sPrepare local assets%s\n' "$C_CYAN" "$C_RESET" "$C_YELLOW" "$C_RESET"
printf '        $ pnpm build\n'
pnpm build

printf '%s[blackbox]%s Pack the complete Phase 1 workspace package closure.\n' "$C_CYAN" "$C_RESET"
printf '{"name":"blackbox-capsule-packed-consumer","private":true,"type":"module","dependencies":{},"pnpm":{"overrides":{}}}\n' \
  >"$CONSUMER_ROOT/package.json"

PACKED_PACKAGE_NAMES=()
DRIVER_TARBALL=""
TELEMETRY_TARBALL=""
for package in "${PHASE_ONE_PACKAGES[@]}"; do
  package_directory="$REPO_ROOT/packages/$package"
  package_name="$(jq -er '.name' "$package_directory/package.json")"
  package_version="$(jq -er '.version' "$package_directory/package.json")"
  archive_name="${package_name#@}"
  archive_name="${archive_name/\//-}-$package_version.tgz"
  archive="$PACK_ROOT/$archive_name"
  pnpm --config.ignore-scripts=true --dir "$package_directory" \
    pack --pack-destination "$PACK_ROOT" --silent >/dev/null
  if [[ ! -s "$archive" ]]; then
    echo "capsule-assets: package did not produce its expected archive: $package_name" >&2
    exit 1
  fi
  temporary_document="$CONSUMER_ROOT/package.json.next"
  jq --arg name "$package_name" --arg archive "file:$archive" \
    '.dependencies[$name] = $archive | .pnpm.overrides[$name] = $archive' \
    "$CONSUMER_ROOT/package.json" >"$temporary_document"
  mv "$temporary_document" "$CONSUMER_ROOT/package.json"
  PACKED_PACKAGE_NAMES+=("$package_name")
  if [[ "$package" == driver ]]; then DRIVER_TARBALL="$archive"; fi
  if [[ "$package" == telemetry ]]; then TELEMETRY_TARBALL="$archive"; fi
done

printf '%s[blackbox]%s Install only packed package artifacts into an external consumer.\n' \
  "$C_CYAN" "$C_RESET"
# The external consumer proves that the packed tarballs declare an installable
# dependency closure. --prefer-offline reuses the workspace store where it can,
# while allowing pnpm to retrieve missing registry metadata or package content.
pnpm --dir "$CONSUMER_ROOT" install --ignore-workspace --prefer-offline --ignore-scripts \
  --store-dir "$PNPM_STORE_DIR"
BLACKBOX_BIN="$CONSUMER_ROOT/node_modules/.bin/blackbox"
BLACKBOX_ENTRYPOINT="$CONSUMER_ROOT/node_modules/@suites/blackbox-cli/bin/run.js"
if [[ ! -x "$BLACKBOX_BIN" ]]; then
  echo 'capsule-assets: the packed CLI did not install its blackbox executable' >&2
  exit 1
fi
if [[ ! -f "$BLACKBOX_ENTRYPOINT" ]]; then
  echo 'capsule-assets: the packed CLI did not install its Node entrypoint' >&2
  exit 1
fi

for driver in public-api postgres redis; do
  if [[ ! -s "$DRIVER_DIRECTORY/$driver.mjs" ]]; then
    echo "capsule-assets: missing project driver: $driver" >&2
    exit 1
  fi
done

# Reset before installing generated assets: reset deliberately removes generated
# driver state. Existing live sessions are stopped through the packed CLI.
BLACKBOX_ENTRYPOINT="$BLACKBOX_ENTRYPOINT" node "$SCRIPT_DIR/capsule-reset.mjs"
mkdir -p "$ARTIFACT_ROOT" "$DRIVER_DIRECTORY"
cat >"$DRIVER_DIRECTORY/package.json" <<EOF
{
  "name": "blackbox-project-drivers",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@suites/blackbox-driver": "file:$DRIVER_TARBALL",
    "@suites/blackbox-telemetry-internal": "file:$TELEMETRY_TARBALL"
  }
}
EOF
(
  cd "$E2E_ROOT"
  "$BLACKBOX_BIN" driver install --runtime node --json \
    >"$ARTIFACT_ROOT/driver-install.json"
)
jq -e --arg spec "file:$DRIVER_TARBALL" '
  .kind == "driver-runtime-installation-succeeded" and
  .dependency.kind == "driver-sdk-installed" and
  .dependency.spec == $spec
' "$ARTIFACT_ROOT/driver-install.json" >/dev/null
# Confirm repeated installation retains the project-owned package contract and
# keeps the packed Driver SDK resolvable without workspace imports.
(
  cd "$E2E_ROOT"
  "$BLACKBOX_BIN" driver install --runtime node --json \
    >"$ARTIFACT_ROOT/driver-install-after-sdk.json"
)
jq -e '
  .kind == "driver-runtime-installation-succeeded" and
  .files.package == "retained" and
  .files.runtime == "retained" and
  .dependency.kind == "driver-sdk-installed"
' "$ARTIFACT_ROOT/driver-install-after-sdk.json" >/dev/null

PACKAGE_NAMES_JSON="$(printf '%s\n' "${PACKED_PACKAGE_NAMES[@]}" | \
  jq -Rsc 'split("\n") | map(select(length > 0))')"
jq -n \
  --arg assetRoot "$ASSET_ROOT" \
  --arg consumerRoot "$CONSUMER_ROOT" \
  --arg blackboxBin "$BLACKBOX_BIN" \
  --arg driverDirectory "$DRIVER_DIRECTORY" \
  --argjson packages "$PACKAGE_NAMES_JSON" \
  '{assetRoot: $assetRoot, consumerRoot: $consumerRoot, blackboxBin: $blackboxBin,
    driverDirectory: $driverDirectory, packages: $packages}' \
  >"$STATE_FILE"
chmod 600 "$STATE_FILE"
node "$SCRIPT_DIR/capsule-asset-boundary.mjs" verify \
  >"$ARTIFACT_ROOT/package-boundary.json"
env -u NODE_OPTIONS "$BLACKBOX_BIN" --help >/dev/null

printf '%s\n' \
  "build=passed" \
  "phase-one-packages=${#PHASE_ONE_PACKAGES[@]}" \
  "packed-consumer=$CONSUMER_ROOT" \
  "blackbox-bin=$BLACKBOX_BIN" \
  "project-drivers=validated" \
  "driver-sdk=packed-project-local" \
  "workspace-imports=absent" \
  >"$ARTIFACT_ROOT/receipt.txt"
ASSETS_READY=1
printf '%s[blackbox]%s %s✓ assets ready%s\n' "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
printf '        artifacts: %s\n' "$ARTIFACT_ROOT"
