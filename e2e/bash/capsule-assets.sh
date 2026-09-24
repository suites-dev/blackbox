#!/usr/bin/env bash

# Prepare the assets consumed by capsule-test.sh. This script does not acquire
# Docker resources or start a Capsule. It only builds the local packages. The
# user-visible player installs generated inputs before it validates the catalog.

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

require_command pnpm
require_command docker

cd "$REPO_ROOT"
printf '%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$C_BLUE" "$C_RESET"
printf '%s[blackbox]%s %sPrepare local assets%s\n' "$C_CYAN" "$C_RESET" "$C_YELLOW" "$C_RESET"
printf '        $ pnpm build\n'
pnpm build

printf '        $ docker build --tag blackbox-otel-collector:dev packages/otel-collector\n'
docker build --tag blackbox-otel-collector:dev packages/otel-collector

printf '%s\n' \
  "build=passed" \
  "collector-image=blackbox-otel-collector:dev" \
  >"$ARTIFACT_ROOT/receipt.txt"
printf '%s[blackbox]%s %s✓ assets ready%s\n' "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
printf '        artifacts: %s\n' "$ARTIFACT_ROOT"
