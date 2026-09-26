# Your first Capsule

Create a subscription in the included application, inspect the activity and runtime observations, and save a report.
The application includes Node services, PostgreSQL, Redis, and LocalStack so you can explore a request that crosses
several service boundaries.

## 1. Open the example project

Complete [installation](installation.md) first, including the `blackbox` shell shortcut. In the same terminal:

```sh
cd "$blackbox_checkout/e2e"
```

This is the example application's project directory. Blackbox reads its catalog and stores experiment records here.

## 2. Prepare the application

Install the Node instrumentation and validate the included catalog:

```sh
blackbox inst install --runtime node
blackbox catalog validate --json
blackbox catalog list --json
```

Validation should return `ok: true`, and the catalog list should include `subscription-system`.
The application is already configured in [blackbox.config.yaml](../e2e/blackbox.config.yaml).
Instrumentation files and dependencies are installed under `e2e/.blackbox/instrumentation/`.

## 3. Start a Capsule

```sh
capsule_start=$(blackbox capsule start \
  --system subscription-system \
  --title "My first Capsule" \
  --description "Explore subscription creation" \
  --json)

SESSION_ID=$(printf '%s' "$capsule_start" | jq -er '.sessionId')
ENTRYPOINT_URL=$(printf '%s' "$capsule_start" | jq -er '.entrypoint.url')
printf 'Session: %s\nApplication: %s\n' "$SESSION_ID" "$ENTRYPOINT_URL"
```

Wait for startup to finish successfully before continuing. Blackbox starts the application's containers,
activates instrumentation, and checks readiness. The returned URL uses the dynamically assigned port.

## 4. Send a request

The sample database includes a user named Alice. Create her subscription:

```sh
blackbox capsule exec \
  --session "$SESSION_ID" \
  --name 'Create Alice subscription' \
  --purpose stimulus -- \
  curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"userId":"alice","paymentMethodId":"pm_demo_alice"}' \
  "$ENTRYPOINT_URL/subscriptions"
```

You should see a JSON response containing an active subscription. Blackbox also prints the retained activity ID.
Sending the same request again returns HTTP `409` because Alice already has a subscription.
Start a fresh Capsule to repeat with fresh data.

This runs your host's `curl` and records its result. The application's instrumentation emits runtime observations.
This simple command does not inject an activity trace header, so inspect those observations at session scope.
The optional guided demo below also shows drivers that add trace context.
For a request-to-trace walkthrough, continue with [investigating a subscription](experiments.md).

## 5. Inspect observations and open a report

```sh
blackbox observations --session "$SESSION_ID" --json
blackbox capsule report export --session "$SESSION_ID" --format html
```

Telemetry delivery can lag behind the response; query again if it has not arrived yet.
The export command prints the HTML file path. Open that file in your browser to inspect the session and activity.

For a live viewer:

```sh
blackbox capsule report serve --session "$SESSION_ID" --open
```

Press Ctrl-C when you finish viewing. This stops a viewer started by this command; the Capsule keeps running.

## 6. Stop the application

```sh
blackbox capsule stop --session "$SESSION_ID" --json
blackbox capsule report export --session "$SESSION_ID" --format html
```

The stop result reports cleanup. The second export updates the report with the stopped state.
Your session remains under `e2e/.blackbox/experiments/capsule-<session-id>/`, and the HTML report is under
`e2e/.blackbox/reports/capsule-<session-id>/`. If you leave the guide early, use the stop command to release the Capsule.

## Try the guided demo

After stopping your Capsule, you can run a walkthrough that shows HTTP, Redis, and PostgreSQL drivers,
observation queries, and reports. From the repository root, in a terminal with Bash available:

```sh
cd "$blackbox_checkout"
pnpm test:e2e:capsule
```

The demo presents commands step by step, waits for Enter, and opens the viewer.
It prepares its dependencies and cleans up the application when finished. To run without pauses or browser opening,
use `pnpm test:e2e:capsule </dev/null`.

The demo resets previous example sessions and generated output under `e2e/.blackbox/`. Copy any reports you want to
keep outside that directory before running it.

Next, explore [Capsule commands](experiments.md), [reports](reports.md), or [configuration](configuration.md).
