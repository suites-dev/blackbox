#!/usr/bin/env bash

# Phase 1: real catalog -> Capsule -> user-owned clients -> live reports -> exports.
# First run: bash e2e/bash/capsule-assets.sh
# Then run:  bash e2e/bash/capsule-test.sh
# A terminal gets explanations, colors, browser opening, and Enter pauses.
# Redirected/noninteractive runs execute the same commands without opening a browser.
# Only the viewer uses a background process; cleanup and assertions live in support.

set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/capsule-test-support.sh"

run_captured_step \
  'Install the standalone Node instrumentation bundle and its dependencies.' \
  'blackbox inst install --runtime node' \
  "$ARTIFACT_ROOT/instrumentation-install.txt" \
  inst install --runtime node

run_captured_step \
  'Repeat installation: an already installed bundle is left unchanged.' \
  'blackbox inst install --runtime node' \
  "$ARTIFACT_ROOT/instrumentation-repeat.txt" \
  inst install --runtime node

run_captured_step \
  'Prepare the project-owned Node client directory without installing protocol dependencies.' \
  'blackbox client install --runtime node --json' \
  "$ARTIFACT_ROOT/client-install.json" \
  client install --runtime node --json
jq -e '.kind == "client-runtime-installation" and .dependencyOwnership == "user"' \
  "$ARTIFACT_ROOT/client-install.json" >/dev/null

run_captured_step \
  'Validate the catalog and every referenced Compose input.' \
  'blackbox catalog validate --json' \
  "$ARTIFACT_ROOT/catalog-validate.json" \
  catalog validate --json
jq -e '.ok == true' "$ARTIFACT_ROOT/catalog-validate.json" >/dev/null

run_captured_step \
  'List the actual systems and subsystems available for acquisition.' \
  'blackbox catalog list --json' \
  "$ARTIFACT_ROOT/catalog-list.json" \
  catalog list --json
jq -e --arg system "$SYSTEM_ID" '.entries | any(.id == $system)' \
  "$ARTIFACT_ROOT/catalog-list.json" >/dev/null

# Start the registry before acquisition so admission/startup can appear live.
# In a terminal this executes: blackbox capsule report serve --open (default port)
start_report_server

# Start one real Capsule. The JSON response is the source of the exact session
# identity and mapped public API URL used by every later command.
run_captured_step \
  'Acquire the subscription system and retain its exact session and endpoint.' \
  'blackbox capsule start \
        --system subscription-system \
        --title "Subscription system demo" \
        --description "Subscription system Capsule E2E" \
        --env FIXTURE_CONTROL_TOKEN=<redacted> \
        --json' \
  "$ARTIFACT_ROOT/capsule-start.json" \
  capsule start \
  --system "$SYSTEM_ID" \
  --title "Subscription system demo" \
  --description "Subscription system Capsule E2E" \
  --env "FIXTURE_CONTROL_TOKEN=$FIXTURE_TOKEN" \
  --json

SESSION_ID="$(jq -er '.sessionId' "$ARTIFACT_ROOT/capsule-start.json")"
ENTRYPOINT_URL="$(jq -er '.entrypoint.url' "$ARTIFACT_ROOT/capsule-start.json")"
REPORT_ROOT="$E2E_ROOT/.blackbox/reports/capsule-$SESSION_ID"
mkdir -p "$REPORT_ROOT"
jq -e --arg session "$SESSION_ID" --arg system "$SYSTEM_ID" \
  '.sessionId == $session and .system == $system' \
  "$ARTIFACT_ROOT/capsule-start.json" >/dev/null

assert_served_report running "$ARTIFACT_ROOT/served-running-before.json"
inspect_in_browser "Select '$SESSION_ID' in the registry. Watch its startup records and resources; the experiment is running."

# The user owns the wire. Blackbox passes curl through unchanged and records the
# activity; it does not proxy, rewrite, or synthesize this HTTP exchange.
run_captured_step \
  'Ask the user-owned curl client to verify the public API readiness endpoint.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        -- curl --fail --silent --show-error $ENTRYPOINT_URL/health" \
  "$ARTIFACT_ROOT/health.json" \
  capsule exec --session "$SESSION_ID" -- \
  curl --fail --silent --show-error "$ENTRYPOINT_URL/health"

jq -e '.status == "ready"' "$ARTIFACT_ROOT/health.json" >/dev/null

# JSON mode keeps delegated stdout inside one machine-readable outcome envelope.
# This proves the CLI can be composed by another process without corrupting JSON.
run_captured_step \
  'Run a host command through Capsule JSON mode and retain one parseable outcome.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --json \\
        -- node -e \"process.stdout.write('capsule-json-ok\\\\n')\"" \
  "$ARTIFACT_ROOT/exec-json.json" \
  capsule exec --session "$SESSION_ID" --json -- \
  node -e "process.stdout.write('capsule-json-ok\\n')"
jq -e '.kind == "exited" and .exitCode == 0 and .stdout == "capsule-json-ok\n"' \
  "$ARTIFACT_ROOT/exec-json.json" >/dev/null

# Reset the fixture through its real authenticated control route so the SUT
# state is deterministic before exercising the full subscription path.
run_captured_step \
  'Reset the real fixture through its authenticated control endpoint.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        -- curl --fail --silent --show-error \\
        --request POST \\
        --header \"Authorization: Bearer <redacted>\" \\
        --header 'Content-Type: application/json' \\
        --data '{\"profile\":\"fresh\"}' \\
        $ENTRYPOINT_URL/fixture/reset" \
  "$ARTIFACT_ROOT/reset.json" \
  capsule exec --session "$SESSION_ID" -- \
  curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $FIXTURE_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"profile":"fresh"}' \
  "$ENTRYPOINT_URL/fixture/reset"

# Alice follows the SUT's full path through an authored entrypoint client. The
# client owns fetch and the wire. Blackbox supplies the mapped target and wraps
# the callback in one root activity span without changing the HTTP request.
run_captured_step \
  'Run the authored entrypoint client across the full subscription path.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --client create-subscription \\
        --json \\
        -- alice" \
  "$ARTIFACT_ROOT/client-execution.json" \
  capsule exec --session "$SESSION_ID" --client create-subscription --json -- alice
jq -e \
  '.kind == "client-completed" and .telemetry.kind == "complete" and .result.kind == "json" and .result.value.userId == "alice" and .result.value.subscription.id == "subscription_alice" and .result.value.subscription.status == "active"' \
  "$ARTIFACT_ROOT/client-execution.json" >/dev/null

CLIENT_ACTIVITY_ID="$(jq -er \
  '[.[] | select(.target.kind == "client" and .target.clientId == "create-subscription")][-1].activityId' \
  "$E2E_ROOT/.blackbox/experiments/capsule-$SESSION_ID/activities.json")"

run_captured_step \
  'Read the collector summary retained for this exact Capsule execution.' \
  "blackbox observations --session $SESSION_ID --json" \
  "$ARTIFACT_ROOT/observations-session.json" \
  observations --session "$SESSION_ID" --json
jq -e '.kind == "collector-session-found" and (.traceIds | length > 0)' \
  "$ARTIFACT_ROOT/observations-session.json" >/dev/null

run_captured_step \
  'Read only the spans correlated to the authored client activity.' \
  "blackbox observations \\
        --session $SESSION_ID \\
        --activity $CLIENT_ACTIVITY_ID \\
        --json" \
  "$ARTIFACT_ROOT/observations-activity.json" \
  observations --session "$SESSION_ID" --activity "$CLIENT_ACTIVITY_ID" --json
jq -e --arg activity "$CLIENT_ACTIVITY_ID" \
  '.kind == "collector-activity-found" and .activityId == $activity and (.fragments | length > 0)' \
  "$ARTIFACT_ROOT/observations-activity.json" >/dev/null

TRACE_ID="$(jq -er '.traceIds[0]' "$ARTIFACT_ROOT/observations-activity.json")"
run_captured_step \
  'Pull one exact W3C trace retained by the Capsule collector.' \
  "blackbox observations \\
        --session $SESSION_ID \\
        --trace $TRACE_ID \\
        --json" \
  "$ARTIFACT_ROOT/observations-trace.json" \
  observations --session "$SESSION_ID" --trace "$TRACE_ID" --json
jq -e --arg trace "$TRACE_ID" \
  '.kind == "collector-trace-found" and .traceId == $trace and
   ([.fragments[].request.resourceSpans[]?.scopeSpans[]?.spans[]?] | length) > 1' \
  "$ARTIFACT_ROOT/observations-trace.json" >/dev/null

# Participant execution is a real command inside the Compose `postgres`
# service. It independently checks the durable state produced through HTTP.
run_captured_step \
  'Read the resulting subscription from the PostgreSQL participant container.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --participant postgres \\
        -- psql --username fixture --dbname subscriptions \\
        --tuples-only --no-align \\
        --command \"SELECT user_id || '|' || status FROM subscriptions WHERE user_id = 'alice';\"" \
  "$ARTIFACT_ROOT/postgres.txt" \
  capsule exec \
  --session "$SESSION_ID" \
  --participant postgres \
  -- psql --username fixture --dbname subscriptions --tuples-only --no-align \
  --command "SELECT user_id || '|' || status FROM subscriptions WHERE user_id = 'alice';"
if [[ "$(tr -d '[:space:]' <"$ARTIFACT_ROOT/postgres.txt")" != "alice|active" ]]; then
  echo "capsule-test: PostgreSQL does not contain Alice's active subscription" >&2
  exit 1
fi

# Inspect the application-level fixture state through the wire as a second,
# independent check that the expected subscription is visible.
run_captured_step \
  'Inspect the application fixture state through the user-owned HTTP wire.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        -- curl --fail --silent --show-error \\
        --header \"Authorization: Bearer <redacted>\" \\
        $ENTRYPOINT_URL/fixture/state" \
  "$ARTIFACT_ROOT/fixture-state.json" \
  capsule exec --session "$SESSION_ID" -- \
  curl --fail --silent --show-error \
  --header "Authorization: Bearer $FIXTURE_TOKEN" \
  "$ENTRYPOINT_URL/fixture/state"
jq -e \
  '.subscriptions | any(.userId == "alice" and .status == "active")' \
  "$ARTIFACT_ROOT/fixture-state.json" >/dev/null

# Serving and exporting do not require stopping. The JSON format is the report
# document; --output - sends it to stdout for pipes and agents.
run_captured_step \
  'Export the running experiment as JSON on stdout. This does not stop it.' \
  "blackbox capsule report export \\
        --session $SESSION_ID \\
        --format json \\
        --output -" \
  "$ARTIFACT_ROOT/running-report.json" \
  capsule report export --session "$SESSION_ID" --format json --output -
assert_report "$ARTIFACT_ROOT/running-report.json" running
jq -e '.activities | length >= 6' "$ARTIFACT_ROOT/running-report.json" >/dev/null
jq -e '.observations.kind == "collector-session-found" and (.observations.traceIds | length > 0)' \
  "$ARTIFACT_ROOT/running-report.json" >/dev/null
assert_served_report running "$ARTIFACT_ROOT/served-running-after.json"
jq -e '.document.activities | length >= 6' "$ARTIFACT_ROOT/served-running-after.json" >/dev/null
inspect_in_browser 'The completed commands are now retained activities. Current reporting refreshes records; it does not stream an unfinished command’s stdout/stderr.'

run_captured_step \
  'Write JSON to its automatic report location. The command prints the generated path.' \
  "blackbox capsule report export \\
        --session $SESSION_ID \\
        --format json" \
  "$ARTIFACT_ROOT/json-report-path.txt" \
  capsule report export --session "$SESSION_ID" --format json
assert_report "$REPORT_ROOT/capsule-report.json" running
jq -e --arg session "$SESSION_ID" \
  '.session.sessionId == $session and .lifecycle.kind == "running" and (.activities | length >= 6) and .observations.kind == "collector-session-found"' \
  "$REPORT_ROOT/capsule-report.json" >/dev/null

run_captured_step \
  'Save a portable HTML snapshot at a custom path while the environment is still running.' \
  "blackbox capsule report export \\
        --session $SESSION_ID \\
        --format html \\
        --output .blackbox/reports/capsule-$SESSION_ID/running.html" \
  "$ARTIFACT_ROOT/running-html-path.txt" \
  capsule report export --session "$SESSION_ID" --format html \
  --output ".blackbox/reports/capsule-$SESSION_ID/running.html"
assert_html "$REPORT_ROOT/running.html"
RUNNING_HTML_CHECKSUM="$(cksum <"$REPORT_ROOT/running.html")"

# Stop and report by exact session ID. Reporting must work after the sandbox is
# gone and must describe this session rather than an implicit latest result.
run_captured_step \
  'Stop the exact session and release only its owned resources.' \
  "blackbox capsule stop \\
        --session $SESSION_ID \\
        --json" \
  "$ARTIFACT_ROOT/capsule-stop.json" \
  capsule stop --session "$SESSION_ID" --json
SESSION_STOPPED=1
assert_report "$REPORT_ROOT/capsule-report.json" running
test "$(cksum <"$REPORT_ROOT/running.html")" = "$RUNNING_HTML_CHECKSUM"

run_captured_step \
  'Read the retained report by exact session ID after teardown.' \
  "blackbox capsule report export \\
        --session $SESSION_ID \\
        --format json \\
        --output -" \
  "$ARTIFACT_ROOT/capsule-report.json" \
  capsule report export --session "$SESSION_ID" --format json --output -
jq -e --arg session "$SESSION_ID" --arg system "$SYSTEM_ID" \
  '.session.sessionId == $session and .session.system == $system and .lifecycle.kind == "stopped" and .cleanup.kind == "complete"' \
  "$ARTIFACT_ROOT/capsule-report.json" >/dev/null

# Generate the portable HTML projection from the same exact retained session.
# It must remain readable after Docker teardown and must not expose the token.
run_captured_step \
  'Render the retained Capsule report as standalone HTML after teardown.' \
  "blackbox capsule report export \\
        --session $SESSION_ID \\
        --format html" \
  "$ARTIFACT_ROOT/capsule-report-html-path.txt" \
  capsule report export --session "$SESSION_ID" --format html
assert_html "$REPORT_ROOT/capsule-report.html"
assert_served_report stopped "$ARTIFACT_ROOT/served-stopped.json"
inspect_in_browser 'The Capsule is stopped and cleanup is complete. Flight control is still available. The earlier running.html is a snapshot; it does not change with the viewer.'

# Close only the viewer, then reopen directly on this exact retained experiment.
# This exercises --session independently of the registry's browser navigation.
stop_report_server
start_report_server "$SESSION_ID"
assert_served_report stopped "$ARTIFACT_ROOT/served-reopened.json"
inspect_in_browser 'This viewer opened directly on the stopped experiment with --session. No containers were restarted. Press Enter when finished; the script then closes only its viewer.'
stop_report_server

# Keep the retained record inventory visible in the receipt for independent
# validators: session, activities, progress, JSON report and HTML projection.
printf '%s\n' \
  "session=$SESSION_ID" \
  "session-artifact=$E2E_ROOT/.blackbox/experiments/capsule-$SESSION_ID/session.json" \
  "activity-artifact=$E2E_ROOT/.blackbox/experiments/capsule-$SESSION_ID/activities.json" \
  "progress-artifact=$E2E_ROOT/.blackbox/experiments/capsule-$SESSION_ID/progress.json" \
  "session-observations=$ARTIFACT_ROOT/observations-session.json" \
  "activity-observations=$ARTIFACT_ROOT/observations-activity.json" \
  "trace-observations=$ARTIFACT_ROOT/observations-trace.json" \
  "json-report=$ARTIFACT_ROOT/capsule-report.json" \
  "html-report=$REPORT_ROOT/capsule-report.html" \
  "running-json-report=$REPORT_ROOT/capsule-report.json" \
  "running-html-report=$REPORT_ROOT/running.html" \
  "served-running=$ARTIFACT_ROOT/served-running-after.json" \
  "served-stopped=$ARTIFACT_ROOT/served-stopped.json" \
  "served-reopened=$ARTIFACT_ROOT/served-reopened.json" \
  >"$ARTIFACT_ROOT/receipt.txt"

printf '\n%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$C_GREEN" "$C_RESET"
printf '%s[blackbox]%s %sCapsule journey passed%s\n' "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
printf '%s        session: %s%s\n' "$C_DIM" "$SESSION_ID" "$C_RESET"
printf '%s        artifacts: %s%s\n' "$C_DIM" "$ARTIFACT_ROOT" "$C_RESET"
