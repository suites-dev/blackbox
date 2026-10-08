# Set up Blackbox for a repo

Use this route when the user asks to set Blackbox up for a repository, not for a direct catalog or Capsule request.
It reuses the `discovery`, `catalog` and `capsule` skills; read them for procedure. Check that each is available
first, and report a missing one as a blocker.

## Done means

All of these, each with its own evidence:

1. The system starts locally: `capsule up --json` exits 0 with `kind: capsule-started`. A failed `up` exits 125 but can
   still return a `sessionId`; that is a retained failure, not a start.
2. It is a fresh capsule acquired for this run.
3. One action was issued (`capsule run`), with its `activityId`.
4. Evidence was collected (`capsule show`, and a report written after `down`).
5. The result was inspected against the accepted expectation, with the report status and limitations stated.
6. Cleanup was confirmed: `capsule down --json` returns `cleanup: complete`, `capsule ls --all` shows `stopped`, and
   Docker shows nothing left for the capsule's Compose project (below). `ls` reads recorded state, not Docker.

A config file, a passing `catalog validate` or an installed package is not done.

Docker check, with the project name from the `up` JSON (`composeProject`) or, after a failed `up`, from its
`Compose configured: <project>` progress line. Run it after `down` and after any failed `up`; all three must be empty:

```sh
docker ps -a --filter "label=com.docker.compose.project=<project>" --format '{{.Names}}'
docker network ls --filter "label=com.docker.compose.project=<project>" --format '{{.Name}}'
docker volume ls -q --filter "label=com.docker.compose.project=<project>"
```

## Path

1. **Understand how the system runs.** Follow discovery's initial setup: inventory, Compose files, Dockerfiles,
   readiness, state and reset. Do not run package scripts to find out.
2. **Choose a small boundary.** The smallest system or subsystem that contains one accepted behavior.
3. **Write `blackbox.config.yaml`** at the repo root, with ordered Compose files under `.blackbox/catalog/`. Use the
   catalog skill and the installed schema. `drivers` and `observation` are required on every entry (`drivers: {}`
   is valid). For Node services add instrumentation with `blackbox inst install --runtime node` and an activation.
4. **Validate statically.** `blackbox catalog validate --json`, then `blackbox systems`. This proves the files parse,
   not that anything starts.
5. **One Capsule run.** With the capsule skill: `blackbox capsule up <system> --json`, one `capsule run` with an
   explicit `--session`, then inspect.
6. **Inspect, stop, then report.** `blackbox capsule show <id>` while it runs, then `down <id>` (`down` accepts only a `running` or `stop-failed` capsule; after a `start-failed` `up`, startup already tried its own cleanup, so skip `down` and use the Docker check),
   then `blackbox capsule show <id>` and `blackbox capsule report <id>` again. A report written while the capsule
   runs is `provisional` and does not draw the final evidence: `down` drains the collector, and only the report
   after `down` can be `complete`. Judge absence and exact-count expectations only from that one.

## Specification source

Use an accepted spec if there is one (an existing test, issue or document the user names). Never change the spec to
fit what the implementation does. If none exists, say the expectation is unspecified and ask; a recorded observation
is not an expectation.

Not available on this release, so do not invent commands: Features and Spec Kit flows, `feature validate|verify`,
`spec draft`, and the Playwright-feature flow. They are planned. Native Playwright (`@suites/blackbox-playwright`,
`test.system`) exists as a package, but it is not needed for the first verification; use the discovery
Playwright reference only if the user asks for a test.

## When it fails

Read the structured result (`--json`; `capsule show`), fix the setup, retry with a new capsule. Seen in a dry run:

- `capsule-operation-failed` at `start`, message `required variable GREETING is missing a value`: a Compose `${VAR:?}`
  had no value. Provide it (see Secrets) and retry.
- `listen EINVAL ... .sock` with state `manager-failed`: the project path was too long for a Unix socket. Use a shorter
  path.
- `down` returned `SandboxStopError` ("cleanup timed out after 60000ms"), state `stop-failed`, for a service whose
  PID 1 was `node -e`. Adding `init: true` to the service made cleanup `complete` in about 3 seconds. The cause was
  not proven. A `stop-failed` capsule is a cleanup failure: check Docker yourself (#89, #90).

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
