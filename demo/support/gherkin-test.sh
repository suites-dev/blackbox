#!/usr/bin/env bash

# Registry-consumer acceptance for the Gherkin features in e2e/features. The
# caller prepares the disposable consumer first and names the packed
# @suites/blackbox-gherkin tarball in BLACKBOX_GHERKIN_PACKAGE: the package is a
# private preview, so the test registry cannot serve it.
#
# This script materializes the e2e project in the consumer, compiles the
# accepted features, runs the generated tests against the Docker demo system
# under strict verdicts and the runner-policy baseline, verifies the run, and
# proves that every scenario of the native subscription spec is supported by
# the feature too. It then runs the same feature against a build of the demo app
# that does not persist subscriptions (a patch applied to the consumer's copy
# only), which must fail at the stored-state step's .feature line.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
E2E_ROOT="$REPO_ROOT/e2e"
RESULT_ROOT="$E2E_ROOT/test-results/gherkin"
STATE_FILE="$E2E_ROOT/.blackbox/capsule-assets.json"
FIXTURE_TOKEN="gherkin-e2e-token"
FEATURE="features/subscription-intake.feature"
NO_PERSIST_PATCH="$SCRIPT_DIR/gherkin-no-persist.patch"
SUT_IMAGE="sut-public-api:local"
NO_PERSIST_IMAGE="sut-public-api:gherkin-no-persist"
ASSET_ROOT=""
CONSUMER_ROOT=""
BLACKBOX_BIN=""
PLAYWRIGHT_BIN=""
EVIDENCE_ROOT=""
RUN_IN_PROGRESS=0
RUN_STATUS=0
VERIFY_STATUS=0

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "gherkin-test: required command is unavailable: $1" >&2
    exit 1
  }
}

# Sandbox records live under the consumer's test-results, which both runs use.
recover_sandboxes() {
  if [[ -n "$EVIDENCE_ROOT" && -d "$EVIDENCE_ROOT" && -d "$CONSUMER_ROOT" ]]; then
    node "$CONSUMER_ROOT/playwright-recover.mjs" >"$EVIDENCE_ROOT/$1-recovery.json"
  fi
}

retain_results() {
  if [[ -n "$EVIDENCE_ROOT" && -d "$EVIDENCE_ROOT" ]]; then
    rm -rf "$RESULT_ROOT"
    mkdir -p "$(dirname -- "$RESULT_ROOT")"
    cp -R "$EVIDENCE_ROOT" "$RESULT_ROOT"
  fi
}

cleanup() {
  local original_status=$?
  local final_status=$original_status
  trap - EXIT INT TERM

  if [[ "$RUN_IN_PROGRESS" -eq 1 ]] && ! recover_sandboxes interrupted; then
    echo 'gherkin-test: interrupted Sandbox recovery failed' >&2
    final_status=1
  fi
  if docker image inspect "$NO_PERSIST_IMAGE" >/dev/null 2>&1 &&
    ! docker image rm "$NO_PERSIST_IMAGE" >/dev/null; then
    echo "gherkin-test: removing $NO_PERSIST_IMAGE failed" >&2
    final_status=1
  fi
  if ! retain_results; then
    echo 'gherkin-test: retaining Gherkin artifacts failed' >&2
    final_status=1
  fi
  if ! node "$REPO_ROOT/scripts/consumer/capsule-asset-cleanup.mjs"; then
    echo 'gherkin-test: registry consumer cleanup failed' >&2
    final_status=1
  fi
  echo "gherkin-test: artifacts retained at $RESULT_ROOT" >&2
  exit "$final_status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command docker
require_command git
require_command jq
require_command node
require_command npm
docker info >/dev/null

rm -rf "$RESULT_ROOT"

if [[ ! -f "$STATE_FILE" ]]; then
  echo 'gherkin-test: registry consumer is not prepared; run pnpm prepare:consumer' >&2
  exit 1
fi
GHERKIN_PACKAGE="${BLACKBOX_GHERKIN_PACKAGE:-}"
if [[ ! -f "$GHERKIN_PACKAGE" || "$(basename -- "$GHERKIN_PACKAGE")" != suites-blackbox-gherkin-*.tgz ]]; then
  echo 'gherkin-test: BLACKBOX_GHERKIN_PACKAGE must name the packed @suites/blackbox-gherkin tarball' >&2
  echo '  (pnpm --dir packages/gherkin pack --pack-destination <directory>)' >&2
  exit 1
fi
GHERKIN_PACKAGE="$(cd -- "$(dirname -- "$GHERKIN_PACKAGE")" && pwd)/$(basename -- "$GHERKIN_PACKAGE")"

ASSET_ROOT="$(jq -er '.assetRoot' "$STATE_FILE")"
CONSUMER_ROOT="$(jq -er '.consumerRoot' "$STATE_FILE")"
BLACKBOX_BIN="$(jq -er '.blackboxBin' "$STATE_FILE")"
TEMP_ROOT="$(cd -- "${TMPDIR:-/tmp}" && pwd)"
ASSET_PARENT="$(cd -- "$(dirname -- "$ASSET_ROOT")" && pwd)"
ASSET_NAME="$(basename -- "$ASSET_ROOT")"
[[ "$ASSET_PARENT" == "$TEMP_ROOT" && "$ASSET_NAME" =~ ^blackbox-capsule-assets\.[A-Za-z0-9]+$ ]] || {
  echo "gherkin-test: refusing unowned asset root: $ASSET_ROOT" >&2
  exit 1
}
[[ "$CONSUMER_ROOT" == "$ASSET_ROOT/consumer" ]] || {
  echo 'gherkin-test: consumer does not belong to the prepared asset root' >&2
  exit 1
}
[[ "$BLACKBOX_BIN" == "$CONSUMER_ROOT/node_modules/.bin/blackbox" && -x "$BLACKBOX_BIN" ]] || {
  echo 'gherkin-test: prepared consumer does not expose the Blackbox CLI' >&2
  exit 1
}
EVIDENCE_ROOT="$CONSUMER_ROOT/test-results/gherkin-evidence"
mkdir -p "$EVIDENCE_ROOT"

# The project a user repository would own: the native project files, which the
# parity listing loads, plus the Gherkin project file, config, baseline and
# features.
mkdir -p "$CONSUMER_ROOT/.blackbox/catalog" "$CONSUMER_ROOT/.blackbox/drivers"
mkdir -p "$CONSUMER_ROOT/tests/playwright" "$CONSUMER_ROOT/reporters"
cp "$E2E_ROOT/blackbox.config.yaml" "$CONSUMER_ROOT/blackbox.config.yaml"
cp "$E2E_ROOT/.blackbox/catalog/"*.yml "$CONSUMER_ROOT/.blackbox/catalog/"
cp "$E2E_ROOT/.blackbox/drivers/"*.mjs "$CONSUMER_ROOT/.blackbox/drivers/"
cp -R "$E2E_ROOT/sut" "$CONSUMER_ROOT/sut"
cp "$E2E_ROOT/playwright.config.ts" "$CONSUMER_ROOT/playwright.config.ts"
cp "$E2E_ROOT/reporters/"*.ts "$CONSUMER_ROOT/reporters/"
cp "$E2E_ROOT/tests/playwright/"*.ts "$CONSUMER_ROOT/tests/playwright/"
cp "$E2E_ROOT/blackbox.feature.yaml" "$CONSUMER_ROOT/blackbox.feature.yaml"
cp "$E2E_ROOT/playwright.gherkin.config.ts" "$CONSUMER_ROOT/playwright.gherkin.config.ts"
cp "$E2E_ROOT/blackbox.policy.yaml" "$CONSUMER_ROOT/blackbox.policy.yaml"
cp -R "$E2E_ROOT/features" "$CONSUMER_ROOT/features"
cp "$SCRIPT_DIR/playwright-evidence.mjs" "$CONSUMER_ROOT/playwright-evidence.mjs"
cp "$SCRIPT_DIR/playwright-report-proof.mjs" "$CONSUMER_ROOT/playwright-report-proof.mjs"
cp "$SCRIPT_DIR/playwright-recover.mjs" "$CONSUMER_ROOT/playwright-recover.mjs"

cd "$CONSUMER_ROOT"
export NPM_CONFIG_REGISTRY="${BLACKBOX_TEST_REGISTRY:-http://127.0.0.1:4874/}"
export NPM_CONFIG_CACHE="$ASSET_ROOT/npm-cache"

npm install --prefix "$CONSUMER_ROOT" --ignore-scripts --no-audit --no-fund --loglevel warn \
  "$GHERKIN_PACKAGE" >"$EVIDENCE_ROOT/gherkin-install.txt" 2>&1
# Generated tests, the config and the reporter must share the consumer's one
# @suites/blackbox-playwright, or the strict reporter would not see the tests.
node --input-type=module -e '
  import { realpathSync } from "node:fs";
  import { createRequire } from "node:module";
  const consumer = createRequire(`${process.cwd()}/package.json`);
  const gherkin = createRequire(consumer.resolve("@suites/blackbox-gherkin"));
  const [own, viaGherkin] = [consumer, gherkin].map((from) =>
    realpathSync(from.resolve("@suites/blackbox-playwright")));
  if (own !== viaGherkin) {
    console.error(`gherkin-test: two @suites/blackbox-playwright copies: ${own} and ${viaGherkin}`);
    process.exit(1);
  }
'

"$BLACKBOX_BIN" inst install --runtime node >"$EVIDENCE_ROOT/instrumentation-install.txt"
test -s "$CONSUMER_ROOT/.blackbox/instrumentation/instrumentation.js"
"$BLACKBOX_BIN" catalog validate --json >"$EVIDENCE_ROOT/catalog-validate.json"
jq -e '.ok == true' "$EVIDENCE_ROOT/catalog-validate.json" >/dev/null

PLAYWRIGHT_BIN="$CONSUMER_ROOT/node_modules/.bin/playwright"
if [[ ! -x "$PLAYWRIGHT_BIN" ]]; then
  echo 'gherkin-test: registry consumer did not install Playwright' >&2
  exit 1
fi

# tee retains evidence but must not hide an interactive terminal from Playwright.
if [[ -t 1 && -z "${PLAYWRIGHT_FORCE_TTY:-}" ]]; then
  export PLAYWRIGHT_FORCE_TTY="${COLUMNS:-80}"
fi
export BLACKBOX_E2E_FIXTURE_TOKEN="$FIXTURE_TOKEN"

"$BLACKBOX_BIN" feature compile | tee "$EVIDENCE_ROOT/compile.txt"

# Runs the compiled feature once and moves its results to $EVIDENCE_ROOT/<name>.
# Sets RUN_STATUS to Playwright's exit status and VERIFY_STATUS to verify's.
run_feature() {
  local name="$1"
  RUN_STATUS=0
  VERIFY_STATUS=0
  rm -rf "$CONSUMER_ROOT/test-results/gherkin"
  RUN_IN_PROGRESS=1
  "$PLAYWRIGHT_BIN" test --config "$CONSUMER_ROOT/playwright.gherkin.config.ts" 2>&1 \
    | tee "$EVIDENCE_ROOT/$name-execution.txt" || RUN_STATUS=$?
  recover_sandboxes "$name"
  RUN_IN_PROGRESS=0
  "$BLACKBOX_BIN" feature verify 2>&1 | tee "$EVIDENCE_ROOT/$name-verify.txt" || VERIFY_STATUS=$?
  local json_status=0
  "$BLACKBOX_BIN" feature verify --json >"$EVIDENCE_ROOT/$name-verify.json" || json_status=$?
  if [[ "$json_status" -ne "$VERIFY_STATUS" ]]; then
    echo "gherkin-test: verify exited $VERIFY_STATUS, but $json_status with --json" >&2
    exit 1
  fi
  mv "$CONSUMER_ROOT/test-results/gherkin" "$EVIDENCE_ROOT/$name"
}

run_feature supported
if [[ "$RUN_STATUS" -ne 0 || "$VERIFY_STATUS" -ne 0 ]]; then
  echo "gherkin-test: the feature run exited $RUN_STATUS and verify $VERIFY_STATUS" >&2
  exit 1
fi

BLACKBOX_E2E_RESULTS_ROOT="$CONSUMER_ROOT/test-results/native-list" \
  "$PLAYWRIGHT_BIN" test --config "$CONSUMER_ROOT/playwright.config.ts" --list --reporter=json \
  >"$EVIDENCE_ROOT/native-list.json"
node "$SCRIPT_DIR/gherkin-proof.mjs" parity \
  "$EVIDENCE_ROOT/native-list.json" "$EVIDENCE_ROOT/supported-verify.json" \
  >"$EVIDENCE_ROOT/parity.json"

# The negative control: the same compiled feature against a public-api that
# answers as if it stored the subscription and stores nothing. Only the
# consumer's copy is patched, and it builds under its own image tag.
# GIT_CEILING_DIRECTORIES keeps git apply from treating an enclosing repository
# as the patch root.
(
  cd "$CONSUMER_ROOT/sut"
  export GIT_CEILING_DIRECTORIES="$CONSUMER_ROOT"
  git apply --check "$NO_PERSIST_PATCH"
  git apply "$NO_PERSIST_PATCH"
)
CATALOG="$CONSUMER_ROOT/.blackbox/catalog/subscription-system.yml"
[[ "$(grep -c "image: $SUT_IMAGE\$" "$CATALOG")" -eq 1 ]] || {
  echo "gherkin-test: expected one $SUT_IMAGE service in $CATALOG" >&2
  exit 1
}
sed -i "s|image: $SUT_IMAGE\$|image: $NO_PERSIST_IMAGE|" "$CATALOG"

run_feature no-persist
if [[ "$RUN_STATUS" -eq 0 || "$VERIFY_STATUS" -eq 0 ]]; then
  echo "gherkin-test: against the app that does not persist subscriptions, the run exited $RUN_STATUS and verify $VERIFY_STATUS" >&2
  exit 1
fi
node "$SCRIPT_DIR/gherkin-proof.mjs" negative-control \
  "$CONSUMER_ROOT/$FEATURE" "$EVIDENCE_ROOT/no-persist/results.json" \
  "$EVIDENCE_ROOT/no-persist-verify.json" \
  >"$EVIDENCE_ROOT/negative-control.json"

jq -r '.rows[] | "parity: \(.native) <- \(.gherkin | map("\(.verdict) \(.title)") | join("; "))"' \
  "$EVIDENCE_ROOT/parity.json"
jq -r '"negative control: \(.expected.file | split("/") | last):\(.expected.line) \(.expected.step) failed as expected"' \
  "$EVIDENCE_ROOT/negative-control.json"
printf '%s\n' \
  'Gherkin journey passed' \
  "registry-consumer=$CONSUMER_ROOT" \
  "artifacts=$RESULT_ROOT"
