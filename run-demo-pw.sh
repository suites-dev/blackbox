#!/usr/bin/env bash
# Run the installed-package demo with native Playwright reporting.
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

case "${1:-}" in
  -h|--help)
    printf '%s\n' \
      'Usage: ./run-demo-pw.sh' \
      '' \
      'Requires Node 22+, pinned pnpm, npm, Docker, curl, git, tar and jq.' \
      'Builds this checkout and publishes ONLY to a fresh loopback registry.' \
      'Runs eight real system/subsystem tests with native Playwright reporting.' \
      'Test files: e2e/tests/playwright/payment-service.spec.ts' \
      '            e2e/tests/playwright/subscription-system.spec.ts' \
      'Uses an isolated fixture copy; existing e2e evidence is left untouched.' \
      'Stops its registry on exit and retains logs/artifacts under .blackbox/tmp/.'
    exit 0 ;;
  '') ;;
  *) printf 'run-demo-pw: unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
if [[ $# -ne 0 ]]; then
  echo 'run-demo-pw: no positional arguments are accepted' >&2
  exit 2
fi

for tool in node pnpm npm docker curl git tar jq; do
  command -v "$tool" >/dev/null || { echo "run-demo-pw: $tool is required" >&2; exit 1; }
done
EXPECTED_PNPM="$(node -p 'require("./package.json").packageManager.replace("pnpm@", "")')"
[[ "$(pnpm --version)" == "$EXPECTED_PNPM" ]] || {
  echo "run-demo-pw: use pnpm $EXPECTED_PNPM (see package.json)" >&2
  exit 1
}
docker info >/dev/null

mkdir -p "$REPO_ROOT/.blackbox/tmp"
RUN_ROOT="$(mktemp -d "$REPO_ROOT/.blackbox/tmp/playwright-demo.XXXXXX")"
REGISTRY_ID=''
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$REGISTRY_ID" ]]; then
    if ! docker rm --force "$REGISTRY_ID" >>"$RUN_ROOT/setup.log" 2>&1; then
      echo 'run-demo-pw: owned registry cleanup failed; see setup.log' >&2
      status=1
    fi
  fi
  printf '\n[run-demo-pw] Artifacts: %s/project/e2e/test-results\n' "$RUN_ROOT"
  printf '[run-demo-pw] Setup log: %s/setup.log\n' "$RUN_ROOT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$RUN_ROOT/registry" "$RUN_ROOT/tarballs" "$RUN_ROOT/project"
echo '[run-demo-pw] Installing the pinned workspace dependencies and building packages...'
pnpm install --frozen-lockfile >"$RUN_ROOT/setup.log" 2>&1
pnpm build >>"$RUN_ROOT/setup.log" 2>&1

echo '[run-demo-pw] Starting a fresh local registry on an available loopback port...'
REGISTRY_ID="$(docker run --detach \
  --name "blackbox-pw-$(basename -- "$RUN_ROOT")" \
  --user "$(id -u):$(id -g)" \
  --publish '127.0.0.1::4873' \
  --volume "$REPO_ROOT/.github/verdaccio/config.yaml:/verdaccio/conf/config.yaml:ro" \
  --volume "$RUN_ROOT/registry:/verdaccio/storage" \
  verdaccio/verdaccio:6.10.3)"
PORT="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "4873/tcp") 0).HostPort}}' "$REGISTRY_ID")"
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo 'run-demo-pw: invalid registry port' >&2; exit 1; }
REGISTRY="http://127.0.0.1:${PORT}/"
curl --retry 60 --retry-all-errors --retry-delay 1 --max-time 3 \
  --fail --silent "${REGISTRY}-/ping" >>"$RUN_ROOT/setup.log" 2>&1

echo '[run-demo-pw] Packing and publishing this build to the local registry...'
pnpm --recursive --filter './packages/*' exec pnpm pack \
  --pack-destination "$RUN_ROOT/tarballs" >>"$RUN_ROOT/setup.log" 2>&1
for tarball in "$RUN_ROOT/tarballs/"*.tgz; do
  env "npm_config_//127.0.0.1:${PORT}/:_authToken=blackbox-e2e" \
    npm publish "$tarball" --registry "$REGISTRY" --tag e2e \
      --provenance=false >>"$RUN_ROOT/setup.log" 2>&1
done

# Copy tracked inputs from the working tree, including local edits, but never
# generated e2e state. The existing consumer harness owns its normal cleanup.
git ls-files -z -- e2e scripts/consumer demo/support .github/scripts \
  package.json lerna.json 'packages/*/package.json' \
  | tar -c --null -T - | tar -x -C "$RUN_ROOT/project"

echo '[run-demo-pw] Installing the consumer, then running eight real Playwright tests...'
printf '%s\n' \
  '[run-demo-pw] Source: e2e/tests/playwright/payment-service.spec.ts' \
  '[run-demo-pw] Source: e2e/tests/playwright/subscription-system.spec.ts' \
  '[run-demo-pw] Runner: playwright test --config playwright.config.ts (inside the installed consumer)'
echo '[run-demo-pw] Each test starts its own sandbox. Native steps and ready/cleanup messages appear live.'
cd "$RUN_ROOT/project"
BLACKBOX_TEST_REGISTRY="$REGISTRY" pnpm test:e2e:playwright
