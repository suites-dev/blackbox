# Investigate with a Capsule

Start a configured system, run an experiment, and retain its commands and
observations. Use a Capsule to investigate an uncertain behavior before turning
it into a repeatable Playwright test.

You need a valid catalog, Docker, and the Capsule integration.
[Install `@suites/blackbox-capsule`](../installation.md#add-optional-integrations)
in your test project before using its commands.

## Start and identify the experiment

From the application's project root:

```sh
npx blackbox catalog validate --json
npx blackbox capsule up <system-id> --json
```

Replace `<system-id>` with the real catalog ID. Keep the returned `sessionId` and
entrypoint URL. For the [first-test project](../getting-started.md), use `items`.
Startup must complete successfully before you send its business request.

## Run one action

For the tutorial service, substitute the returned values into this command:

```sh
npx blackbox capsule run --session <session-id> -- \
  curl --fail --silent --show-error --request POST <entrypoint-url>/items
```

The expected tutorial response is the created item's JSON. Keep the activity ID
and command result. Plain host commands do not automatically inject trace headers;
[project drivers](../drivers.md) can prepare endpoints and propagation when configured.

The tutorial service has no instrumentation activation. Its command result is useful
HTTP evidence, but it will not produce application traces merely because it runs
inside a Capsule.

## Inspect, stop, and retain the report

```sh
npx blackbox capsule show <session-id>
npx blackbox capsule down <session-id>
npx blackbox capsule report serve --session <session-id> --open
```

Stop the Capsule even if the experiment fails. Check the reported cleanup outcome.
The viewer reads retained session records; stopping the viewer is separate from
stopping a running Capsule.

When a configured observer records runtime data, preserve its scope and limitations.
A completed collector drain does not prove every relevant operation was instrumented.
[Operational reference](../../packages/capsule/skills/capsule/references/capsule-experiments.md).

## Turn the finding into a regression test

Use the accepted requirement to choose assertions. The final Playwright test must
recreate its own preconditions and collect fresh observations. It does not inherit
the successful Capsule's state or result.

Capsule runs commands and drivers; it does not execute `.feature` suites.
Review recorded effects against the accepted requirement before adopting an
[effects baseline](../contracts/effects-snapshots.md).

[Native tests](../playwright/README.md) · [Reports](reports.md) ·
[Evidence](../concepts/behavioral-evidence.md)
