# Write executable Gherkin specifications

Use the scoped TypeScript DSL to keep a readable specification and its typed
implementation in one Playwright test file. Use the optional `.feature` compiler
when your team reviews a separate Gherkin artifact. Both routes execute native
Playwright tests in a fresh Blackbox Sandbox per attempt, including retries.

| Choose           | Author                                                         | Run                                           |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------- |
| TypeScript DSL   | `Feature`/`Rule`/`Scenario` with typed callbacks in `.spec.ts` | Playwright runs the specification directly.   |
| Feature compiler | `.feature` sentences from the supported HTTP vocabulary        | Emit `.spec.ts`, then run it with Playwright. |

These APIs are available in the source workspace alpha. Build the workspace
packages before running a consumer. The Playwright adapter requires Node.js
22.15 or later, `@playwright/test` 1.61 or later within major version 1, Docker,
and a catalog in `blackbox.config.yaml`. See the
[adapter reference](../packages/playwright/README.md) for configuration, clients,
fixtures, reporting, and cleanup.

## Run a TypeScript specification directly

Configure `blackboxConfigFile` with
`defineConfig` from `@suites/blackbox-playwright/config` in your Playwright config.
The example assumes the catalog declares `subscription-system` and that the
project's client module exports a typed `api` client with a `post` method.

```ts
import { expect, test } from '@suites/blackbox-playwright';
import * as clients from './clients.js';

test.system('subscription-system', (system) => {
  system.sandbox('default', { clients }, ({ Feature }) => {
    Feature('Subscription activation', ({ Background, Rule }) => {
      Background('A fresh system', ({ Given }) => {
        Given('the subscription state is reset', async ({ clients }) => {
          const response = await clients.api.post('/fixture/reset', {
            data: { profile: 'fresh' },
          });
          expect(response.status()).toBe(200);
        });
      });

      Rule('Subscriptions become active', ({ Scenario }) => {
        Scenario('Alice subscribes', async ({ Given }) => {
          await Given('Alice has a payment method', async ({ When }) => {
            const paymentMethodId = 'pm_alice_primary';

            await When('Alice activates a subscription', async ({ request, stimulus, Then }) => {
              const response = await stimulus(({ headers }) =>
                request.post('/subscriptions', {
                  data: { userId: 'alice', paymentMethodId },
                  headers,
                }),
              );

              await Then('an active subscription is returned', async () => {
                expect(response.status()).toBe(201);
                expect(await response.json()).toMatchObject({
                  userId: 'alice',
                  subscription: { status: 'active' },
                });
              });
            });
          });
        });
      });
    });
  });
});
```

Save this as `tests/subscription.spec.ts`, then run:

```sh
pnpm exec playwright test tests/subscription.spec.ts
```

Playwright discovers native tests under the system, Sandbox, Feature, and Rule
hierarchy. `Given`, `When`, `Then`, `And`, and `But` appear as sibling native steps in
execution order. Assertions use the normal Playwright fixtures and the typed
clients registered for that Sandbox.

Playwright currently attributes registered scenarios to the adapter's declaration
module in source locations. Reports still show the Feature, Rule, scenario, and
step titles; open the TypeScript specification to find its authoring line.

`Feature`, `Rule`, `Background`, and `ScenarioOutline` declarations are
synchronous. A `Scenario` callback runs during the test and can await `Given`.
Inside a `Given` callback, `await When(...)` schedules the action after that
Given step closes. Inside a `When` callback, `await Then(...)`, `await And(...)`,
and `await But(...)` schedule assertions after that When step closes. These registration calls do not
run the nested body before returning. Keep assertions that need an action's
response in closures declared within its `When` callback, as shown above.

Each Scenario requires a `Given`, and each scenario Given requires at least one
`When`. Each When phase requires one `Then`; use `And` or `But` for additional
assertions in that phase. `But` preserves its step label and runs the callback
you supply; express any negative expectation explicitly in that callback. Step and
declaration handles expire when their callback returns.

Declare a Background before scenarios, once per scope. It registers Given setup
that runs before each applicable scenario or Examples row. Feature and Rule
Backgrounds apply at their respective scopes.
A Rule exposes scenarios and its own Background; Rules do not nest.

For parameterized cases, declare `ScenarioOutline(title, callback)`, register a
`Given` callback, and call `Examples(title, rows)` within that synchronous
callback. Each Examples table needs nonempty rows with consistent nonempty keys
and string values; step callbacks receive their `row`.
Titles interpolate `<column>` placeholders. Each Examples row becomes a separate
native test and Sandbox attempt; its Examples title and row index distinguish
identical values. See the
[subscription example](../e2e/examples/gherkin-executable-spec.ts).

The DSL also exposes the Gherkin aliases `Example` for `Scenario`,
`ScenarioTemplate` for `ScenarioOutline`, and `Scenarios` for `Examples`, in the
same scopes as their canonical names. These aliases use the same execution and
row expansion behavior. The Gherkin `*` keyword is unsupported in this TypeScript
DSL; use the explicit scoped step methods.

`stimulus(body)` is available inside `When`. It binds the action to the attempt's
stimulus context and supplies W3C propagation headers. Pass those headers through
your request or SDK transport before asserting `effects`. Merely naming a step
`When` does not propagate context. Effects describe observed operations; durable
state and asynchronous completion need their own assertions and wait boundaries.

## Compile a separate Feature file

The `.feature` compiler remains supported by `@suites/blackbox-feature`. It has a
closed HTTP vocabulary; arbitrary English steps, queue sentences, and effects
sentences do not become executable automatically.

```gherkin
@system:subscription-system
Feature: API health
  Scenario: The API is ready
    When client "api" sends GET "/health"
    Then the response status is 200
```

Save this as `tests/api-health.feature`. Supply a project-owned TypeScript client
registration module through `--clients`. The CLI recognizes directly named
exported variable declarations; re-export barrels are not recognized by this
compiler's binding scan. The selected catalog ID and kind must match the
`@system:<id>` or `@subsystem:<id>` tag. The CLI finds the nearest catalog above
the Feature, or accepts `--config <path>`.

```sh
pnpm exec blackbox feature step list
pnpm exec blackbox feature file validate tests/api-health.feature --clients tests/clients.ts
pnpm exec blackbox feature suite emit tests/api-health.feature --clients tests/clients.ts --output tests/api-health.spec.ts
pnpm exec playwright test tests/api-health.spec.ts
pnpm exec blackbox feature suite validate tests/api-health.feature --clients tests/clients.ts --output tests/api-health.spec.ts
```

Validation reports compilation diagnostics without starting a Sandbox. Emission
writes deterministic native TypeScript and refuses to overwrite an existing
output. Suite validation compares generated bytes with the existing output and
fails on drift. After a Feature change, emit to a new path and review the diff
before replacing the previous suite. Compilation does not typecheck or run the
suite; Playwright execution is still required.

## Keep the routes' guarantees clear

The TypeScript DSL has no companion Feature file to regenerate or compare. Its
callbacks implement the reviewed specification directly, with project-owned
clients and assertions. The compiler route keeps the `.feature` source and checks
its generated artifact for deterministic drift. It does not validate arbitrary
handwritten TypeScript against a Feature.

Neither route implements a second runner, automatic English step matching, or
completed-run verification against a Feature. `feature file draft` and
`feature run verify` are registered but exit unavailable. Executable Feature
coverage, specification change-policy gates, and emitting a `.feature` projection
from the TypeScript DSL are unavailable.

For exact compiler sentences and command flags, use the
[Feature CLI reference](../packages/feature/src/cli/README.md).
