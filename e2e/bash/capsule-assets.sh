#!/usr/bin/env bash

# Prepare the assets consumed by capsule-test.sh. This script does not acquire
# Docker resources or start a Capsule. It builds the local CLI and validates the
# canonical catalog so the later run is only the user-visible command journey.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$E2E_ROOT/.." && pwd)"
ARTIFACT_ROOT="$E2E_ROOT/.blackbox/tmp/capsule-assets"
mkdir -p "$ARTIFACT_ROOT"

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

require_command jq
require_command pnpm

cd "$REPO_ROOT"
printf '%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$C_BLUE" "$C_RESET"
printf '%s[blackbox]%s %sPrepare local assets%s\n' "$C_CYAN" "$C_RESET" "$C_YELLOW" "$C_RESET"
printf '        $ pnpm build\n'
pnpm build

cd "$E2E_ROOT"
printf '%s[blackbox]%s %sValidate the canonical catalog and referenced files%s\n' "$C_CYAN" "$C_RESET" "$C_YELLOW" "$C_RESET"
printf '        $ blackbox catalog validate --json\n'
if [[ -n "${BLACKBOX_BIN:-}" ]]; then
  BLACKBOX_COMMAND=("$BLACKBOX_BIN")
else
  BLACKBOX_COMMAND=(node "$REPO_ROOT/packages/cli/bin/run.js")
fi
"${BLACKBOX_COMMAND[@]}" catalog validate --json >"$ARTIFACT_ROOT/catalog-validate.json"
"${BLACKBOX_COMMAND[@]}" catalog list --json >"$ARTIFACT_ROOT/catalog-list.json"
jq -e '.ok == true and .kind == "catalog-validate-success"' "$ARTIFACT_ROOT/catalog-validate.json" >/dev/null
jq -e '(.entries | any(.id == "subscription-system" and .isDefault == true))' "$ARTIFACT_ROOT/catalog-list.json" >/dev/null

printf '%s\n' \
  "catalog-validate=$ARTIFACT_ROOT/catalog-validate.json" \
  "catalog-list=$ARTIFACT_ROOT/catalog-list.json" \
  "build=passed" \
  >"$ARTIFACT_ROOT/receipt.txt"
printf '%s[blackbox]%s %s✓ assets ready%s\n' "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
printf '        artifacts: %s\n' "$ARTIFACT_ROOT"
