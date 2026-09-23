#!/usr/bin/env bash

# Sourced by capsule-test.sh. Presentation, process ownership, and checks stay
# here so the walkthrough shows the actual public CLI journey clearly.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$E2E_ROOT/.." && pwd)"

SYSTEM_ID="subscription-system"
FIXTURE_TOKEN="capsule-e2e-token"
mkdir -p "$E2E_ROOT/.blackbox/tmp"
ARTIFACT_ROOT="$(mktemp -d "$E2E_ROOT/.blackbox/tmp/capsule-test.XXXXXX")"
SESSION_ID=""
SESSION_STOPPED=0
REPORT_SERVER_PID=""
INTERACTIVE=0
if [[ -t 0 && -t 1 ]]; then
  INTERACTIVE=1
fi

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_CYAN=$'\033[36m'
  C_BLUE=$'\033[34m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET=''; C_DIM=''; C_CYAN=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi

if [[ -n "${BLACKBOX_BIN:-}" ]]; then
  BLACKBOX_COMMAND=("$BLACKBOX_BIN")
elif [[ -f "$REPO_ROOT/packages/cli/bin/run.js" ]]; then
  # A checkout must exercise the CLI built from this tree, not a stale global
  # executable that may expose an older command registry.
  BLACKBOX_COMMAND=(node "$REPO_ROOT/packages/cli/bin/run.js")
else
  BLACKBOX_COMMAND=(blackbox)
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "capsule-test: required command is unavailable: $1" >&2
    exit 1
  fi
}

blackbox() {
  "${BLACKBOX_COMMAND[@]}" "$@"
}

explain_step() {
  printf '\n%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$C_BLUE" "$C_RESET"
  printf '%s[blackbox]%s %s%s%s\n' "$C_CYAN" "$C_RESET" "$C_YELLOW" "$1" "$C_RESET"
  printf '%s        $ %s%s\n' "$C_DIM" "$2" "$C_RESET"
  if [[ "$INTERACTIVE" -eq 1 ]]; then
    read -r -p '        Press Enter to run it... '
  fi
}

inspect_in_browser() {
  printf '\n%s[flight control]%s %s\n' "$C_CYAN" "$C_RESET" "$1"
  printf '        %s?type=capsule&id=%s\n' "$REPORT_SERVER_ORIGIN/" "$SESSION_ID"
  if [[ "$INTERACTIVE" -eq 1 ]]; then
    read -r -p '        Inspect the browser, then press Enter to continue... '
  fi
}

run_captured_step() {
  local explanation="$1"
  local command_display="$2"
  local output_file="$3"
  shift 3

  explain_step "$explanation" "$command_display"

  blackbox "$@" >"$output_file"
  printf '%s[blackbox]%s %s✓ completed%s\n' "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
  if [[ -s "$output_file" ]]; then
    printf '%s[blackbox] output%s\n' "$C_DIM" "$C_RESET"
    sed 's/^/        /' "$output_file"
  fi
}

cleanup() {
  local original_status=$?
  local final_status=$original_status
  trap - EXIT INT TERM

  if [[ -n "$REPORT_SERVER_PID" ]]; then
    if ! stop_report_server; then final_status=1; fi
  fi

  # A failure after startup must not strand resources. Stop only the exact
  # session acquired by this script; never select an implicit latest session.
  if [[ -n "$SESSION_ID" && "$SESSION_STOPPED" -eq 0 ]]; then
    if ! blackbox capsule stop --session "$SESSION_ID" --json \
      >"$ARTIFACT_ROOT/cleanup-stop.json"; then
      echo "capsule-test: cleanup failed for session $SESSION_ID" >&2
      final_status=1
    fi
  fi

  echo "capsule-test: artifacts retained at $ARTIFACT_ROOT" >&2
  exit "$final_status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command jq
require_command curl

cd "$E2E_ROOT"

if [[ ! -s "$E2E_ROOT/.blackbox/tmp/capsule-assets/catalog-list.json" ]]; then
  echo "capsule-test: run e2e/bash/capsule-assets.sh first" >&2
  exit 1
fi

# The foreground CLI server is backgrounded only by this demonstration harness.
# The stored PID always belongs to the actual node/blackbox process, not a shell function.
start_report_server() {
  local selected="${1:-}"
  local args=(capsule report serve --port 0)
  local display='blackbox capsule report serve \
        --port 0'
  local label=registry
  if [[ -n "$selected" ]]; then
    args+=(--session "$selected")
    display+=$' \\\n        --session '"$selected"
    label=selected
  fi
  if [[ "$INTERACTIVE" -eq 1 ]]; then
    args+=(--open)
    display+=$' \\\n        --open'
  fi
  explain_step 'Serve flight control. This viewer has an independent lifetime from the Capsule.' "$display"
  local log="$ARTIFACT_ROOT/report-server-$label.log"
  "${BLACKBOX_COMMAND[@]}" "${args[@]}" >"$log" 2>&1 &
  REPORT_SERVER_PID=$!
  REPORT_SERVER_URL=""
  local attempt
  for attempt in {1..100}; do
    REPORT_SERVER_URL="$(sed -n 's/^Blackbox reports: //p' "$log" | head -n 1)"
    if [[ -n "$REPORT_SERVER_URL" ]]; then break; fi
    if ! kill -0 "$REPORT_SERVER_PID" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ -z "$REPORT_SERVER_URL" ]]; then
    cat "$log" >&2
    echo 'capsule-test: report server did not announce a URL' >&2
    exit 1
  fi
  # Drop the selection query before constructing API endpoints.
  REPORT_SERVER_ORIGIN="${REPORT_SERVER_URL%%\?*}"
  REPORT_SERVER_ORIGIN="${REPORT_SERVER_ORIGIN%/}"
  curl --fail --silent --show-error "$REPORT_SERVER_ORIGIN/api/reports" \
    >"$ARTIFACT_ROOT/report-registry-$label.json"
  jq -e '.kind == "report-registry" and (.failures | length == 0)' \
    "$ARTIFACT_ROOT/report-registry-$label.json" >/dev/null
  printf '%s[blackbox]%s Flight control: %s\n' "$C_CYAN" "$C_RESET" "$REPORT_SERVER_URL"
}

stop_report_server() {
  if ! kill -INT "$REPORT_SERVER_PID" 2>/dev/null; then
    echo 'capsule-test: viewer did not accept shutdown' >&2
    return 1
  fi
  local status=0
  wait "$REPORT_SERVER_PID" || status=$?
  REPORT_SERVER_PID=""
  if [[ "$status" -ne 0 ]]; then
    echo "capsule-test: viewer exited with $status" >&2
    return 1
  fi
  printf '%s[blackbox]%s %s✓ viewer stopped; retained experiment files remain%s\n' "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
}

assert_report() {
  jq -e --arg session "$SESSION_ID" --arg state "$2" \
    '.kind == "capsule-operational-report" and .session.sessionId == $session and .lifecycle.kind == $state' \
    "$1" >/dev/null
}

assert_served_report() {
  curl --fail --silent --show-error \
    "$REPORT_SERVER_ORIGIN/api/reports/capsule/$SESSION_ID" >"$2"
  jq -e --arg session "$SESSION_ID" --arg state "$1" \
    '.kind == "report-document" and .document.session.sessionId == $session and .document.lifecycle.kind == $state' \
    "$2" >/dev/null
}

assert_html() {
  test -s "$1"
  grep -F 'Capsule report' "$1" >/dev/null
  grep -F "$SESSION_ID" "$1" >/dev/null
  if grep -F "$FIXTURE_TOKEN" "$1" >/dev/null; then
    echo 'capsule-test: report leaked the fixture token' >&2
    exit 1
  fi
}
