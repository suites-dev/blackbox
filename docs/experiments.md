# Investigate a subscription with a Capsule

Follow a request from the command you run to the application's observations and saved state. This walkthrough uses
the included subscription application and the command sequence from the guided demo.

You'll prepare the environment, create a subscription through an HTTP driver, inspect its trace, query PostgreSQL,
and keep a report after stopping the application.

## Define the experiment

The Capsule supplies the environment. The protocol below defines the investigation you carry out in it:

| Part                                             | This experiment                                                                                 |        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------ |
| Question                                         | Does creating a subscription return success and leave Alice with an active subscription?        |        |
| Initial conditions                               | The example reset profile, a known Alice user, and no competing requests from another operator. |        |
| Stimulus                                         | One subscription request with the example payment method.                                       |        |
| Measurements                                     | The response, service observations, and a PostgreSQL state query.                               |        |
| Completion                                       | The request finishes; query the resulting state and allow telemetry delivery.                   |        |
| Criteria                                         | Check the successful response and `alice                                                        | active |
| state. Inspect service participation separately. |

A single run of this procedure is a trial. The commands retain evidence for you to inspect; they do not invoke an
automated claim evaluator. The procedure does not establish absence of every error or exactly one downstream request.
Those claims would need their own measurements and completeness conditions.

See [the verification model](verification-machine.md) for planning trials and distinguishing discovery from
confirmation.

## Prepare the project

Complete [installation](installation.md), including the local SDK setup for project drivers.
Use the `blackbox` shortcut in the same terminal, from the example application directory:

```sh
cd "$blackbox_checkout/e2e"
blackbox driver install --runtime node --json
blackbox inst install --runtime node
blackbox catalog validate --json
blackbox catalog list --json
```

The two installers serve different purposes: the driver SDK prepares operator commands; instrumentation runs inside
the application to produce telemetry. Repeating `inst install --runtime node` leaves a current installation unchanged.

Catalog validation checks the configuration and referenced files. Listing shows selectable systems, including
`subscription-system`. Neither command starts the application.

## Watch startup in the report viewer

You can open the viewer before starting a Capsule to watch its startup records appear. In another terminal, define
the `blackbox` shortcut as described in installation, enter the same example directory, and run:

```sh
blackbox capsule report serve --open
```

Leave the viewer running while you continue in the first terminal. Its registry will show the Capsule when it
is created. The viewer and application have separate lifecycles.

## Start the Capsule

```sh
capsule_start=$(blackbox capsule start \
  --system subscription-system \
  --title "Subscription investigation" \
  --description "Follow a subscription from request to saved state" \
  --env FIXTURE_CONTROL_TOKEN=capsule-e2e-token \
  --json)

SESSION_ID=$(printf '%s' "$capsule_start" | jq -er '.sessionId')
ENTRYPOINT_URL=$(printf '%s' "$capsule_start" | jq -er '.entrypoint.url')
```

Wait for successful startup before continuing. Save the returned identity and URL rather than assuming a session
or port. The token in this example protects the sample application's control endpoints; it is a disposable demo value.

## Separate inspection, setup, and stimulus

First, check readiness with a plain host command:

```sh
blackbox capsule exec --session "$SESSION_ID" \
  --name 'Check readiness' --purpose inspection -- \
  curl --fail --silent --show-error "$ENTRYPOINT_URL/health"
```

Then establish the example's starting state:

```sh
blackbox capsule exec --session "$SESSION_ID" \
  --name 'Reset example state' --purpose setup -- \
  curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $FIXTURE_CONTROL_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"profile":"fresh"}' \
  "$ENTRYPOINT_URL/fixture/reset"
```

This reset endpoint belongs to the sample application. For your own application, use its setup mechanism.
`setup`, `stimulus`, and `inspection` describe why you perform an action; they do not restrict what the command can
change.
Each action retains its own command result.

## Create a subscription through the HTTP driver

```sh
subscription_result=$(blackbox capsule exec \
  --session "$SESSION_ID" \
  --name 'Create Alice subscription' \
  --driver public-api \
  --purpose stimulus \
  --json -- \
  curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"userId":"alice","paymentMethodId":"pm_capsule_alice"}' \
  /subscriptions)

printf '%s' "$subscription_result" | jq .
DRIVER_ACTIVITY_ID=$(printf '%s' "$subscription_result" | jq -er '.activityId')
```

The driver supplies the endpoint and a W3C trace header. You provide the business request. The JSON result keeps
captured output inside an execution document, so a script or agent can read the activity ID and propagation outcome
without mixing them with delegated stdout. The HTTP response is in `outcome.process.stdout`.

A successful request returns an active subscription. Next, inspect what the instrumented services reported.

## Narrow observations from session to activity to trace

Start with the whole Capsule session:

```sh
blackbox observations --session "$SESSION_ID" --json
```

Then query the activity returned by the HTTP driver:

```sh
activity_observations=$(blackbox observations \
  --session "$SESSION_ID" --activity "$DRIVER_ACTIVITY_ID" --json)
printf '%s' "$activity_observations" | jq .
```

Telemetry may arrive after the command result. If the activity has no trace IDs yet, repeat that query after delivery.
Once it returns a trace ID:

```sh
TRACE_ID=$(printf '%s' "$activity_observations" | jq -er '.traceIds[0]')
blackbox observations --session "$SESSION_ID" --trace "$TRACE_ID" --json
```

These scopes answer different questions:

| Scope    | Question                                                                     |
| -------- | ---------------------------------------------------------------------------- |
| Session  | Which runtimes activated and what telemetry arrived in this Capsule session? |
| Activity | Which observations are correlated to this particular command?                |
| Trace    | Which spans were retained under this exact trace identity?                   |

In this example, look for the subscription request and the participating `public-api`, `fraud-check`, `payment-mock`,
and `order-service` services. An injected trace header enables correlation; received spans establish what was observed.
Observations on another trace can still be evidence from this execution. Session scope matters when a relevant operation
crosses a shared-state boundary or lacks activity correlation; do not discard that evidence merely because a narrower
activity query does not return it.

## Inspect saved state with PostgreSQL

```sh
blackbox capsule exec --session "$SESSION_ID" \
  --name 'Inspect Alice subscription' --driver postgres --purpose inspection -- \
  psql --username fixture --dbname subscriptions \
  --tuples-only --no-align \
  --command "SELECT user_id || '|' || status FROM subscriptions WHERE user_id = 'alice';"
```

The catalog places this command inside the PostgreSQL participant, where `psql` is available. After subscription
creation, the output is `alice|active`. This provides a separate state check alongside the response and trace.
The driver reports shared-state propagation as unsupported. The returned state remains evidence for the subscription
claim, even though the query does not establish a direct trace link to the earlier write.

Read [drivers](drivers.md) for target selection, seeding, migrations, and propagation outcomes.
Before stopping, you can also [use Redis as an entrypoint](async-workflows.md) to investigate a worker across an async
hole.

## Save a snapshot, stop, and inspect again

Export the running experiment without stopping it:

```sh
blackbox capsule report export --session "$SESSION_ID" --format json --output -
blackbox capsule report export --session "$SESSION_ID" --format html \
  --output ".blackbox/reports/capsule-$SESSION_ID/running.html"
```

The live viewer refreshes as records arrive. The HTML file is a snapshot and keeps the state at export time.

When finished:

```sh
blackbox capsule stop --session "$SESSION_ID" --json
blackbox capsule report export --session "$SESSION_ID" --format html
blackbox capsule report serve --session "$SESSION_ID" --open
```

Check the stop result's cleanup outcome. The final HTML export records the stopped state, while `running.html`
remains unchanged. Reopening a retained report does not restart containers. Close the owning viewer terminal when
you no longer need it. If you leave the walkthrough early, stop the Capsule with its saved session ID.

Continue with [instrumentation and adapters](instrumentation.md), [runtime evidence](runtime-evidence.md), or
[report options](reports.md).
