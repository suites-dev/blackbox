# Set up a repository for one accepted behavior

Start in the application repository with its locally installed CLI.

```sh
blackbox onboarding start --json
```

The receipt lists active CLI package versions in `packages`, command availability in
`commands`, direct selections for the live Node/Capsule route in `livePackages`, and
the agent handoff in `instructions`. For a human-readable prompt, omit `--json`.
The command writes to stdout. Repository discovery, config changes and test authoring
are the agent's work.

## Check the installed capabilities

Use the project's package manager, configured registry and lockfile policy. Align
Blackbox versions with the installed CLI. Blackbox declares Node.js `>=22.15`.
Check the engine requirements of the project's resolved dependencies too.

| Task                                  | Packages and capabilities                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover and configure a boundary     | Directly select `@suites/blackbox` and `@suites/blackbox-cli`. The main package contributes Discovery, Catalog and Skills.                                                            |
| Run a live Node/Capsule investigation | Also select `@suites/blackbox-capsule`, `@suites/blackbox-driver` and `@suites/blackbox-inst-runtime-node` as direct dependencies. Docker with Compose runs the selected system.      |
| Author a native acceptance test       | Select the matching `@suites/blackbox-playwright` adapter and its `@playwright/test` peer (`>=1.61.0 <2`). The adapter provides library exports. Check them in the installed version. |

Run `blackbox skills list --json` and use the receipt's host installation commands.
Load the installed `blackbox`, `discovery` and `catalog` skills, plus `capsule` for a
live investigation. If a capability is missing, identify the affected stage. Use the
[installation reference](skill-installation.md) to distinguish a missing provider
from a host that still needs a project-local copy.

## Propose and validate the boundary

1. Start with one accepted rule from a test, issue or specification the developer names.
   If the expected outcome is open, ask the developer to define it before writing assertions.
2. Use Discovery to inspect the existing Compose files, Dockerfiles, entrypoints, readiness
   checks, initial state and reset procedure. Read package scripts before running them.
3. Propose the smallest system or subsystem containing the rule. Identify the stimulus,
   completion condition, authoritative state readers and runtime effects the rule requires.
   Review those choices with the developer.
4. Use Catalog and the installed schema to draft `blackbox.config.yaml` at the repo root.
   Preserve ordered project-relative Compose paths. Moving an existing Compose file can change
   its build, bind-mount and `env_file` paths. Use `.blackbox/catalog/` for newly authored files.
   Each entry requires `drivers` and `observation`. An empty `drivers: {}` is valid.
5. For a Node driver, use `blackbox driver install --runtime node`. For instrumented Node
   participants, use `blackbox inst install --runtime node` and configure their activation.
   Confirm the required commands appear as available in the receipt before invoking them.
6. Run `blackbox catalog validate --json` and `blackbox catalog list --json`. Record the
   validated catalog entry and any unresolved setup. Runtime readiness requires a live check.

## Draft the native acceptance test

Use `defineConfig` from `@suites/blackbox-playwright/config` in the project's
Playwright config and set `blackboxConfigFile` to the catalog path relative to that
config. Select the catalog ID with native `test.use`. Each physical attempt gets a
fresh Sandbox. For example, if the accepted rule requires a valid subscription
request to return HTTP 201, the test can express that outcome directly.

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.use({ blackbox: { system: 'subscription-system' } });

test('accepts a subscription with a valid payment method', async ({ stimulus }) => {
  const { result, verify } = await stimulus(
    'When Alice subscribes with a valid payment method',
    ({ request, headers }) =>
      request.post('/subscriptions', {
        headers,
        data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' },
      }),
  );
  await verify('Then the subscription request succeeds', () => {
    expect(result.status()).toBe(201);
  });
});
```

Use the project's actual catalog entry, route and inputs. If the rule also requires
persistence, register a project-owned reader with `state.observe` before the action,
check its initial value in the stimulus precondition, and assert the matching final
record using `evidence.state(observer)`. Review bindings, assertions and any expected
snapshots with the developer. Observations become acceptance criteria only after review.

Use the project's Playwright command with `--list` to confirm discovery. After approval,
run the selected spec and report its attempt result, evidence and cleanup. The optional
`@suites/blackbox-playwright/reporter` and `@suites/blackbox-playwright/history` exports
support reporting and inspection of retained attempts.

## Verify a live Capsule investigation

With the Capsule skill, acquire a fresh session using
`blackbox capsule up <system> --json --non-interactive`. A successful start exits 0 with
`kind: capsule-started`. A failed start can exit 125 and still return a session ID.
Run one approved action using `blackbox capsule run` with the explicit `--session`.
Keep the session and activity IDs, then inspect with `blackbox capsule show <id>`.

Stop the session with `blackbox capsule down <id> --json`. A successful stop reports
`cleanup: complete`. Inspect `blackbox capsule show <id>`, then write the final report
with `blackbox capsule report <id>`. Stop drains the collector. A report produced while
the session runs is provisional. Assess absence or exact counts only against final
evidence with suitable capture coverage.

Check `blackbox capsule ls --all` for the recorded `stopped` state. Use the actual
`composeProject` from startup or the `Compose configured: <project>` progress line
to check Docker. After cleanup, all three inventories should be empty.

```sh
docker ps -a --filter "label=com.docker.compose.project=<project>" --format '{{.Names}}'
docker network ls --filter "label=com.docker.compose.project=<project>" --format '{{.Name}}'
docker volume ls -q --filter "label=com.docker.compose.project=<project>"
```

After `start-failed`, startup has already attempted cleanup. Check the Compose project
if startup created one. For `stop-failed` or `manager-failed`, retry `down` as directed
by the Capsule skill. Report the accepted expectation, observations, report status,
coverage limitations and owned resources remaining after cleanup.

## When it fails

Read the structured result (`--json`; `capsule show`), fix the setup, retry with a new capsule. Seen in a dry run:

- `capsule-operation-failed` at `start`, message `required variable GREETING is missing a value`: a Compose `${VAR:?}`
  had no value. Provide it (see Secrets) and retry.
- `listen EINVAL ... .sock` with state `manager-failed`: the project path was too long for a Unix socket. Use a shorter
  path.
- `down` returned `SandboxStopError`, state `stop-failed`: Docker did not remove the project within the stop budget.
  The message names what was `still present`. A service whose PID 1 ignores SIGTERM (`node -e`, `sh -c`, busybox
  `httpd -f`) is killed after Docker's stop grace (at most 10 s); `init: true` makes it exit at once. Run `down <id>`
  again: it finishes the cleanup and records the capsule `stopped`. If it fails again, check Docker yourself (#89, #90).

If a dependency, env var, credential, image or capability is missing, stop and report a blocker. Never broaden the
spec, drop a required boundary or weaken a claim to get a pass. Do not repeat a non-idempotent stimulus.

## Secrets and boundaries

- The catalog schema has no secret-reference field. Keep values out of `blackbox.config.yaml` and out of committed
  Compose files: reference them as `${NAME}` (without a committed default) and supply them from the host
  environment, which reaches Compose interpolation, or `capsule up --env NAME=value`. The progress output lists env
  keys, not values. `--env` puts the value on the command line, so prefer the host environment.
- A dependency outside the boundary (a hosted API, a shared database) stays outside. Claims cover only what ran
  inside the capsule.
- A project Compose file whose app needs credentialed sidecars has no supported path yet (#141).
- Never use `--raw-output`.

## What the result can claim

An uninstrumented service still gets `complete`, with no spans: `complete` means the collector drained, not full
instrumentation coverage (#143). Say that the action ran and the response was as expected; do not say what else
was touched. Report status, limitations and cleanup separately.
