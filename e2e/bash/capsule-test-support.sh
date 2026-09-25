#!/usr/bin/env bash

# Sourced by capsule-test.sh. Presentation, process ownership, and checks stay
# here so the walkthrough shows the actual public CLI journey clearly.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$E2E_ROOT/.." && pwd)"
STATE_FILE="$E2E_ROOT/.blackbox/capsule-assets.json"

SYSTEM_ID="subscription-system"
FIXTURE_TOKEN="capsule-e2e-token"
mkdir -p "$E2E_ROOT/.blackbox/tmp"
ARTIFACT_ROOT="$(mktemp -d "$E2E_ROOT/.blackbox/tmp/capsule-test.XXXXXX")"
SESSION_ID=""
SESSION_STOPPED=0
REPORT_SERVER_PID=""
REPORT_SERVER_REUSED=0
PROOF_IMAGE_STATE=""
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
source "$SCRIPT_DIR/capsule-poll-progress.sh"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "capsule-test: required command is unavailable: $1" >&2
    exit 1
  fi
}

require_command jq
if [[ ! -s "$STATE_FILE" ]]; then
  echo 'capsule-test: run e2e/bash/capsule-assets.sh first' >&2
  exit 1
fi
ASSET_ROOT="$(jq -er '.assetRoot' "$STATE_FILE")"
BLACKBOX_BIN="$(jq -er '.blackboxBin' "$STATE_FILE")"
export BLACKBOX_BIN
node "$SCRIPT_DIR/capsule-asset-boundary.mjs" verify "$STATE_FILE" "$REPO_ROOT" \
  >"$E2E_ROOT/.blackbox/tmp/capsule-package-boundary.json"
BLACKBOX_COMMAND=("$BLACKBOX_BIN")

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

run_expected_status_step() {
  local expected_status="$1"
  local explanation="$2"
  local command_display="$3"
  local output_file="$4"
  shift 4

  explain_step "$explanation" "$command_display"
  local error_file="${output_file}.stderr"
  local status=0
  blackbox "$@" >"$output_file" 2>"$error_file" || status=$?
  if [[ "$status" -ne "$expected_status" ]]; then
    cat "$error_file" >&2
    echo "capsule-test: expected exit $expected_status, received $status" >&2
    return 1
  fi
  printf '%s[blackbox]%s %s✓ expected exit %s retained%s\n' \
    "$C_CYAN" "$C_RESET" "$C_GREEN" "$expected_status" "$C_RESET"
  if [[ -s "$output_file" ]]; then
    printf '%s[blackbox] output%s\n' "$C_DIM" "$C_RESET"
    sed 's/^/        /' "$output_file"
  fi
  if [[ -s "$error_file" ]]; then
    printf '%s[blackbox] diagnostics%s\n' "$C_DIM" "$C_RESET"
    sed 's/^/        /' "$error_file"
  fi
}

run_json_until() {
  local explanation="$1"
  local command_display="$2"
  local output_file="$3"
  local predicate="$4"
  shift 4

  explain_step "$explanation" "$command_display"
  local attempt
  for attempt in {1..150}; do
    if blackbox "$@" >"$output_file" && jq -e "$predicate" "$output_file" >/dev/null; then
      printf '%s[blackbox]%s %s✓ observation available%s\n' \
        "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
      printf '%s[blackbox] output%s\n' "$C_DIM" "$C_RESET"
      sed 's/^/        /' "$output_file"
      return 0
    fi
    sleep 0.1
  done
  cat "$output_file" >&2
  echo 'capsule-test: observation did not become available within 15 seconds' >&2
  return 1
}

wait_for_shared_state_proof() {
  local execution_file="$1"
  local activity_file="$2"
  local proof_id="$3"
  local session_file="$4"
  local trace_directory="$5"
  local proof_file="$6"
  local diagnostics_file="${proof_file}.stderr"
  local trace_ids_file="${proof_file}.trace-ids"

  explain_step \
    'Prove Redis shared-state work stayed session-observed and was never attached to its activity.' \
    'blackbox observations --session <id> --json; blackbox observations --trace <id> --json'
  local timeout_seconds=30
  local started_at="$SECONDS"
  local last_progress_second=-1
  local attempt
  for attempt in {1..120}; do
    local condition='waiting for session observations'
    if blackbox observations --session "$SESSION_ID" --json >"$session_file" &&
      jq -e '.kind == "collector-session-found"' "$session_file" >/dev/null; then
      rm -rf "$trace_directory"
      mkdir -p "$trace_directory"
      jq -er '.traceIds[]' "$session_file" >"$trace_ids_file"
      local trace_count
      trace_count="$(wc -l <"$trace_ids_file" | tr -d '[:space:]')"
      condition="reading $trace_count exact traces"
      local traces_complete=1
      while IFS= read -r trace_id; do
        if [[ ! "$trace_id" =~ ^[0-9a-f]{32}$ ]] ||
          ! blackbox observations --session "$SESSION_ID" --trace "$trace_id" --json \
            >"$trace_directory/$trace_id.json"; then
          traces_complete=0
          break
        fi
      done <"$trace_ids_file"
      if [[ "$traces_complete" -eq 1 ]]; then
        condition='waiting for separate consumer -> public-api trace'
        if node "$SCRIPT_DIR/capsule-telemetry-proof.mjs" shared-state \
          "$execution_file" "$activity_file" "$session_file" \
          "$trace_directory" "$proof_id" >"$proof_file" 2>"$diagnostics_file"; then
          finish_poll_progress
          printf '%s[blackbox]%s %s✓ session-only shared-state telemetry proven%s\n' \
            "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
          sed 's/^/        /' "$proof_file"
          return 0
        fi
      fi
    fi
    local elapsed_seconds=$((SECONDS - started_at))
    if [[ "$INTERACTIVE" -eq 1 || "$elapsed_seconds" -ne "$last_progress_second" ]]; then
      render_poll_progress "$elapsed_seconds" "$timeout_seconds" "$condition"
      last_progress_second="$elapsed_seconds"
    fi
    if [[ "$elapsed_seconds" -ge "$timeout_seconds" ]]; then
      break
    fi
    sleep 0.25
  done
  finish_poll_progress
  if [[ -s "$diagnostics_file" ]]; then
    cat "$diagnostics_file" >&2
  fi
  echo 'capsule-test: shared-state telemetry proof did not become available within 30 seconds' >&2
  return 1
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

  if [[ -n "$PROOF_IMAGE_STATE" && -s "$PROOF_IMAGE_STATE" ]]; then
    if ! node "$SCRIPT_DIR/capsule-proof-image.mjs" cleanup \
      "$PROOF_IMAGE_STATE" "$ARTIFACT_ROOT/proof-consumer-image-cleanup.json"; then
      echo 'capsule-test: owned proof-consumer image cleanup failed' >&2
      final_status=1
    fi
  fi

  if ! node "$SCRIPT_DIR/capsule-asset-boundary.mjs" cleanup "$STATE_FILE"; then
    echo "capsule-test: packed asset cleanup failed for $ASSET_ROOT" >&2
    final_status=1
  fi

  echo "capsule-test: artifacts retained at $ARTIFACT_ROOT" >&2
  exit "$final_status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command curl

cd "$E2E_ROOT"

if [[ "$BLACKBOX_BIN" == "$REPO_ROOT"/* || ! -x "$BLACKBOX_BIN" ]]; then
  echo 'capsule-test: acceptance requires the externally installed packed CLI' >&2
  exit 1
fi

# The foreground CLI server is backgrounded only by this demonstration harness.
# The stored PID always belongs to the actual node/blackbox process, not a shell function.
start_report_server() {
  local selected="${1:-}"
  local args=(capsule report serve)
  local display='blackbox capsule report serve'
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
  local attempt ownership
  ownership=""
  for attempt in {1..100}; do
    REPORT_SERVER_URL="$(sed -n 's/^Blackbox reports: //p' "$log" | head -n 1)"
    ownership="$(sed -n 's/^Viewer ownership: //p' "$log" | head -n 1)"
    if [[ -n "$REPORT_SERVER_URL" && -n "$ownership" ]]; then break; fi
    if ! kill -0 "$REPORT_SERVER_PID" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ -z "$REPORT_SERVER_URL" ]]; then
    cat "$log" >&2
    echo 'capsule-test: report server did not announce a URL' >&2
    exit 1
  fi
  ownership="$(sed -n 's/^Viewer ownership: //p' "$log" | head -n 1)"
  if [[ "$ownership" == reused ]]; then
    local reused_pid="$REPORT_SERVER_PID"
    REPORT_SERVER_PID=""
    REPORT_SERVER_REUSED=1
    if ! wait "$reused_pid" 2>/dev/null; then
      echo 'capsule-test: reused viewer exited unsuccessfully' >&2
      return 1
    fi
  else
    if [[ "$ownership" != started ]]; then
      echo "capsule-test: invalid viewer ownership announcement: $ownership" >&2
      return 1
    fi
    REPORT_SERVER_REUSED=0
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
  if [[ "${REPORT_SERVER_REUSED:-0}" -eq 1 ]]; then
    REPORT_SERVER_REUSED=0
    printf '%s[blackbox]%s reused viewer remains running\n' "$C_CYAN" "$C_RESET"
    return 0
  fi
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

assert_shared_state_report() {
  local report_file="$1"
  local downstream_trace_id="$2"
  local stimulus_activity_id="$3"
  jq -e --arg trace "$downstream_trace_id" --arg activity "$stimulus_activity_id" '
    .observations.kind == "collector-session-found" and
    ([.observations.traces.sessionOnly[] |
      select(.traceId == $trace)] | length) == 1 and
    ([.observations.traces.activityCorrelated[] |
      select(.traceId == $trace)] | length) == 0 and
    ([.activityTelemetry[] |
      select(.activityId == $activity and .kind == "available" and (.spans | length) == 1)] |
      length) == 1
  ' "$report_file" >/dev/null
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
