#!/usr/bin/env bash

# Phase 1: real catalog -> Capsule -> user-owned tools -> live reports -> exports.
# First run: bash e2e/bash/capsule-assets.sh
# Then run:  bash e2e/bash/capsule-test.sh
# A terminal gets explanations, colors, browser opening, and Enter pauses.
# Redirected/noninteractive runs execute the same commands without opening a browser.
# Only the viewer uses a background process; cleanup and assertions live in support.

set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/capsule-test-support.sh"

run_captured_step \
  'Prepare the project-owned Node driver directory without installing protocol clients.' \
  'blackbox driver install --runtime node --json' \
  "$ARTIFACT_ROOT/driver-install.json" \
  driver install --runtime node --json
jq -e \
  '.kind == "driver-runtime-installation-succeeded" and
   .dependency.kind == "driver-sdk-installed"' \
  "$ARTIFACT_ROOT/driver-install.json" >/dev/null

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

# Record the exact image baseline before acquisition. Cleanup later removes only
# an image proven to have been built for this Capsule's Compose project.
PROOF_IMAGE_STATE="$ARTIFACT_ROOT/proof-consumer-image-ownership.json"
node "$SCRIPT_DIR/capsule-proof-image.mjs" baseline "$ARTIFACT_NAME"

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
node "$SCRIPT_DIR/capsule-proof-image.mjs" capture \
  "$ARTIFACT_NAME" \
  "$SESSION_ID"

assert_served_report running "$ARTIFACT_ROOT/served-running-before.json"
inspect_in_browser "Select '$SESSION_ID' in the registry. Watch its startup records and resources; the experiment is running."

# The user owns the wire. Blackbox passes curl through unchanged and records the
# activity; it does not proxy, rewrite, or synthesize this HTTP exchange.
run_captured_step \
  'Ask the user-owned curl client to verify the public API readiness endpoint.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Check readiness' \\
        --purpose inspection \\
        -- curl --fail --silent --show-error $ENTRYPOINT_URL/health" \
  "$ARTIFACT_ROOT/health.json" \
  capsule exec --session "$SESSION_ID" --name 'Check readiness' --purpose inspection -- \
  curl --fail --silent --show-error "$ENTRYPOINT_URL/health"

jq -e '.status == "ready"' "$ARTIFACT_ROOT/health.json" >/dev/null

# JSON mode keeps delegated stdout inside one machine-readable outcome envelope.
# This proves the CLI can be composed by another process without corrupting JSON.
run_captured_step \
  'Run a host command through Capsule JSON mode and retain one parseable outcome.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Check CLI JSON mode' \\
        --purpose inspection \\
        --json \\
        -- node -e \"process.stdout.write('capsule-json-ok\\\\n')\"" \
  "$ARTIFACT_ROOT/exec-json.json" \
  capsule exec --session "$SESSION_ID" --name 'Check CLI JSON mode' --purpose inspection --json -- \
  node -e "process.stdout.write('capsule-json-ok\\n')"
jq -e \
  '.kind == "capsule-exec-completed" and .outcome.kind == "exited" and
   .outcome.exitCode == 0 and .outcome.stdout == "capsule-json-ok\n"' \
  "$ARTIFACT_ROOT/exec-json.json" >/dev/null

# Reset the fixture through its real authenticated control route so the SUT
# state is deterministic before exercising the full subscription path.
run_captured_step \
  'Reset the real fixture through its authenticated control endpoint.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Reset fixture state' \\
        --purpose setup \\
        -- curl --fail --silent --show-error \\
        --request POST \\
        --header \"Authorization: Bearer <redacted>\" \\
        --header 'Content-Type: application/json' \\
        --data '{\"profile\":\"fresh\"}' \\
        $ENTRYPOINT_URL/fixture/reset" \
  "$ARTIFACT_ROOT/reset.json" \
  capsule exec --session "$SESSION_ID" --name 'Reset fixture state' --purpose setup -- \
  curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $FIXTURE_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"profile":"fresh"}' \
  "$ENTRYPOINT_URL/fixture/reset"

# Alice follows the SUT's full path through user-owned curl. The HTTP driver
# supplies the mapped endpoint and W3C header without owning the business action.
run_captured_step \
  'Run curl through the HTTP driver with automatic W3C trace propagation.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Create Alice subscription' \\
        --driver public-api \\
        --purpose stimulus \\
        --json \\
        -- curl --fail --silent --show-error \\
        --request POST \\
        --header 'Content-Type: application/json' \\
        --data '{\"userId\":\"alice\",\"paymentMethodId\":\"pm_capsule_alice\"}' \\
        /subscriptions" \
  "$ARTIFACT_ROOT/driver-execution.json" \
  capsule exec \
  --session "$SESSION_ID" \
  --name 'Create Alice subscription' \
  --driver public-api \
  --purpose stimulus \
  --json \
  -- curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"userId":"alice","paymentMethodId":"pm_capsule_alice"}' \
  /subscriptions
jq -e \
  '.kind == "capsule-exec-completed" and
   .outcome.kind == "driver-completed" and
   .outcome.propagation.expectation.kind == "w3c-trace-context-propagation" and
   .outcome.propagation.outcome.kind == "context-injected" and
   .outcome.process.kind == "exited" and
   .outcome.process.exitCode == 0 and
   (.outcome.process.stdout | fromjson | .subscription.status) == "active"' \
  "$ARTIFACT_ROOT/driver-execution.json" >/dev/null

DRIVER_ACTIVITY_ID="$(jq -er '.activityId' "$ARTIFACT_ROOT/driver-execution.json")"

run_json_until \
  'Read the collector summary retained for this exact Capsule execution.' \
  "blackbox observations --session $SESSION_ID --json" \
  "$ARTIFACT_ROOT/observations-session.json" \
  '.kind == "collector-session-found" and (.traceIds | length > 0)' \
  observations --session "$SESSION_ID" --json
jq -e '.kind == "collector-session-found" and (.traceIds | length > 0)' \
  "$ARTIFACT_ROOT/observations-session.json" >/dev/null
jq -e '
  ([.lifecycle.runs[-1].instrumentation.activations[]
    | select(.runtime == "node")
    | .serviceName] | sort) ==
  ["fraud-check", "order-service", "payment-mock", "public-api", "redis-proof-consumer"]
' "$ARTIFACT_ROOT/observations-session.json" >/dev/null

run_json_until \
  'Read only the spans correlated to the traced HTTP driver activity.' \
  "blackbox observations \\
        --session $SESSION_ID \\
        --activity $DRIVER_ACTIVITY_ID \\
        --json" \
  "$ARTIFACT_ROOT/observations-activity.json" \
  '.kind == "collector-activity-found" and (.fragments | length > 0)' \
  observations --session "$SESSION_ID" --activity "$DRIVER_ACTIVITY_ID" --json
jq -e --arg activity "$DRIVER_ACTIVITY_ID" \
  '.kind == "collector-activity-found" and .activityId == $activity and (.fragments | length > 0)' \
  "$ARTIFACT_ROOT/observations-activity.json" >/dev/null

TRACE_ID="$(jq -er '.traceIds[0]' "$ARTIFACT_ROOT/observations-activity.json")"
explain_step \
  'Pull the exact W3C trace until every expected instrumented service has arrived.' \
  "blackbox observations \\
        --session $SESSION_ID \\
        --trace $TRACE_ID \\
        --json"
node "$SCRIPT_DIR/capsule-telemetry-proof.mjs" http-until \
  "$BLACKBOX_ENTRYPOINT" \
  "$SESSION_ID" \
  "$TRACE_ID" \
  "$ARTIFACT_ROOT/driver-execution.json" \
  "$ARTIFACT_ROOT/observations-activity.json" \
  "$ARTIFACT_ROOT/observations-trace.json" \
  "$ARTIFACT_ROOT/http-telemetry-proof.last-incomplete.txt" \
  >"$ARTIFACT_ROOT/http-telemetry-proof.json"
printf '%s[blackbox]%s %s✓ complete HTTP trace proven%s\n' \
  "$C_CYAN" "$C_RESET" "$C_GREEN" "$C_RESET"
sed 's/^/        /' "$ARTIFACT_ROOT/http-telemetry-proof.json"

# Redis is a genuine shared-state entrypoint. The user-owned redis-cli command
# is unchanged inside the Redis participant; no trace context can ride in this
# list item. A blocking SUT consumer reacts and calls public-api on another trace.
PROOF_ID="shared-state-$SESSION_ID"
blackbox observations --session "$SESSION_ID" --json \
  >"$ARTIFACT_ROOT/observations-session-before-shared-state.json"
jq -e '.kind == "collector-session-found"' \
  "$ARTIFACT_ROOT/observations-session-before-shared-state.json" >/dev/null
run_captured_step \
  'Push one proof stimulus through the Redis shared-state driver.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Queue shared-state proof' \\
        --driver redis \\
        --purpose stimulus \\
        --json \\
        -- redis-cli RPUSH blackbox:proof:stimuli $PROOF_ID" \
  "$ARTIFACT_ROOT/redis-execution.json" \
  capsule exec \
  --session "$SESSION_ID" \
  --name 'Queue shared-state proof' \
  --driver redis \
  --purpose stimulus \
  --json \
  -- redis-cli RPUSH blackbox:proof:stimuli "$PROOF_ID"
jq -e -f "$SCRIPT_DIR/capsule-redis-execution.jq" \
  "$ARTIFACT_ROOT/redis-execution.json" >/dev/null
REDIS_ACTIVITY_ID="$(jq -er '.activityId' "$ARTIFACT_ROOT/redis-execution.json")"

run_json_until \
  'Read the exact trace owned by the Redis stimulus activity.' \
  "blackbox observations --session $SESSION_ID --activity $REDIS_ACTIVITY_ID --json" \
  "$ARTIFACT_ROOT/observations-redis-activity.json" \
  '.kind == "collector-activity-found" and (.traceIds | length == 1)' \
  observations --session "$SESSION_ID" --activity "$REDIS_ACTIVITY_ID" --json

wait_for_shared_state_proof \
  "$ARTIFACT_ROOT/redis-execution.json" \
  "$ARTIFACT_ROOT/observations-redis-activity.json" \
  "$PROOF_ID" \
  "$ARTIFACT_ROOT/observations-session-before-shared-state.json" \
  "$ARTIFACT_ROOT/observations-session-shared-state.json" \
  "$ARTIFACT_ROOT/shared-state-traces" \
  "$ARTIFACT_ROOT/shared-state-telemetry-proof.json"
SHARED_DOWNSTREAM_TRACE_ID="$(jq -er '.downstreamTraceId' \
  "$ARTIFACT_ROOT/shared-state-telemetry-proof.json")"

# The Postgres driver declares participant execution, so Capsule runs the
# unchanged user-owned psql command inside the selected Compose container.
run_captured_step \
  'Read the resulting subscription from the PostgreSQL participant container.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Inspect Alice subscription' \\
        --driver postgres \\
        --purpose inspection \\
        --json \\
        -- psql --username fixture --dbname subscriptions \\
        --tuples-only --no-align \\
        --command \"SELECT user_id || '|' || status FROM subscriptions WHERE user_id = 'alice';\"" \
  "$ARTIFACT_ROOT/postgres.json" \
  capsule exec \
  --session "$SESSION_ID" \
  --name 'Inspect Alice subscription' \
  --driver postgres \
  --purpose inspection \
  --json \
  -- psql --username fixture --dbname subscriptions --tuples-only --no-align \
  --command "SELECT user_id || '|' || status FROM subscriptions WHERE user_id = 'alice';"
jq -e '
  .kind == "capsule-exec-completed" and
  .outcome.kind == "driver-completed" and
  .outcome.propagation.expectation.kind == "shared-state-propagation-unsupported" and
  .outcome.propagation.expectation.resource == "postgresql" and
  .outcome.propagation.outcome.kind == "context-not-supported" and
  .outcome.propagation.outcome.boundary == "shared-state" and
  .outcome.propagation.outcome.resource == "postgresql" and
  .outcome.redaction.environment.kind == "keys" and
  .outcome.redaction.environment.keys == ["PGPASSWORD"] and
  (.outcome | has("environment") | not) and
  .outcome.process.kind == "exited" and
  .outcome.process.exitCode == 0 and
  .outcome.process.location.kind == "participant" and
  .outcome.process.location.participantId == "postgres" and
  (.outcome.process.stdout | gsub("\\s"; "")) == "alice|active"
' "$ARTIFACT_ROOT/postgres.json" >/dev/null

run_expected_status_step \
  127 \
  'Retain an actionable failure when a driver-selected participant lacks a tool.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Probe missing participant tool' \\
        --driver postgres \\
        --purpose inspection \\
        --json \\
        -- blackbox-missing-client" \
  "$ARTIFACT_ROOT/missing-executable.json" \
  capsule exec \
  --session "$SESSION_ID" \
  --name 'Probe missing participant tool' \
  --driver postgres \
  --purpose inspection \
  --json \
  -- blackbox-missing-client
jq -e \
  '.kind == "capsule-exec-completed" and
   .outcome.kind == "driver-completed" and
   .outcome.propagation.expectation.kind == "shared-state-propagation-unsupported" and
   .outcome.propagation.expectation.resource == "postgresql" and
   .outcome.propagation.outcome.kind == "context-not-supported" and
   .outcome.propagation.outcome.resource == "postgresql" and
   .outcome.process.kind == "executable-not-found" and
   .outcome.process.location.kind == "participant" and
   .outcome.process.location.participantId == "postgres"' \
  "$ARTIFACT_ROOT/missing-executable.json" >/dev/null

# Inspect the application-level fixture state through the wire as a second,
# independent check that the expected subscription is visible.
run_captured_step \
  'Inspect the application fixture state through the user-owned HTTP wire.' \
  "blackbox capsule exec \\
        --session $SESSION_ID \\
        --name 'Inspect fixture state' \\
        --purpose inspection \\
        -- curl --fail --silent --show-error \\
        --header \"Authorization: Bearer <redacted>\" \\
        $ENTRYPOINT_URL/fixture/state" \
  "$ARTIFACT_ROOT/fixture-state.json" \
  capsule exec --session "$SESSION_ID" --name 'Inspect fixture state' --purpose inspection -- \
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
jq -e '
  .observations.kind == "collector-session-found" and
  .observations.telemetry.status == "received" and
  (.observations.traces.activityCorrelated | length) > 0
' \
  "$ARTIFACT_ROOT/running-report.json" >/dev/null
assert_shared_state_report \
  "$ARTIFACT_ROOT/running-report.json" "$SHARED_DOWNSTREAM_TRACE_ID" "$REDIS_ACTIVITY_ID"
assert_served_report running "$ARTIFACT_ROOT/served-running-after.json"
jq -e '.document.activities | length >= 6' "$ARTIFACT_ROOT/served-running-after.json" >/dev/null
jq '.document' "$ARTIFACT_ROOT/served-running-after.json" \
  >"$ARTIFACT_ROOT/served-running-document.json"
assert_shared_state_report \
  "$ARTIFACT_ROOT/served-running-document.json" \
  "$SHARED_DOWNSTREAM_TRACE_ID" "$REDIS_ACTIVITY_ID"
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
jq -e --arg session "$SESSION_ID" '
  .kind == "capsule-stopped" and .sessionId == $session and
  .cleanup == "complete" and .alreadyStopped == false
' "$ARTIFACT_ROOT/capsule-stop.json" >/dev/null
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
assert_shared_state_report \
  "$ARTIFACT_ROOT/capsule-report.json" "$SHARED_DOWNSTREAM_TRACE_ID" "$REDIS_ACTIVITY_ID"

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
grep -F 'session-only observed traces' "$REPORT_ROOT/capsule-report.html" >/dev/null
grep -F "$SHARED_DOWNSTREAM_TRACE_ID" "$REPORT_ROOT/capsule-report.html" >/dev/null
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
  "driver-execution=$ARTIFACT_ROOT/driver-execution.json" \
  "http-telemetry-proof=$ARTIFACT_ROOT/http-telemetry-proof.json" \
  "redis-execution=$ARTIFACT_ROOT/redis-execution.json" \
  "redis-activity-observations=$ARTIFACT_ROOT/observations-redis-activity.json" \
  "shared-state-telemetry-proof=$ARTIFACT_ROOT/shared-state-telemetry-proof.json" \
  "postgres-execution=$ARTIFACT_ROOT/postgres.json" \
  "missing-executable=$ARTIFACT_ROOT/missing-executable.json" \
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
