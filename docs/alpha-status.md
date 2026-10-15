# Alpha status

BLACKBOX is `0.0.1-alpha`. This page is the trust contract for the alpha: what exists, how to run it, and what does
not exist yet. Other pages must not describe a capability more strongly than this one.

**Audited revision:** `release/v0.0.1-alpha` at `9b15ea42`. Recheck when commands, exports or release availability change.

## Distribution

- **Packages are not published to npm.** Every `@suites/blackbox*` package is at `0.0.1-alpha.0`; the registry
  returns 404 for `@suites/blackbox-cli`, and no tag or GitHub release exists.
- Until the alpha is published, the supported path is a **source checkout**. Install commands that use the
  `@alpha` tag work only after publication.

## Capability status

| Status        | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| **Working**   | Reproduced in the audited source revision (build, CLI or test run).                  |
| **In source** | Implemented in the repository; not reproduced in the audit or not publicly packaged. |
| **In review** | Described in docs or open pull requests; not in the audited source.                  |
| **Roadmap**   | Direction only.                                                                      |

| Capability                                                                                                                                 | Status        | Evidence                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------ |
| Workspace install and build                                                                                                                | Working       | `pnpm install --frozen-lockfile` and `pnpm build` succeeded.                                           |
| CLI: `capsule up/run/show/down/ls/use/report`, `catalog list/validate`, `systems`, `skills list/install`, `driver install`, `inst install` | Working       | Listed by `blackbox --help`; `catalog validate`, `systems` and `skills list` ran against `e2e/`.       |
| CLI: `feature file draft/validate`, `feature step list`, `feature suite emit/validate`, `feature run verify`                               | In source     | Listed by `blackbox --help`; not run in the audit.                                                     |
| Isolated Sandboxes and system execution                                                                                                    | Working       | Eight Playwright tests started Compose systems; see the run below.                                     |
| Native Playwright (`test.system`, sandbox suites, clients, `step`)                                                                         | Working       | Same run.                                                                                              |
| Effects evaluation (`expect(effects).toSatisfy(...)`)                                                                                      | In source     | Used by the bundled spec; its pass is part of the run below, but one test hit a startup failure first. |
| Reports and `blackbox-*` attachments                                                                                                       | In source     | Produced in the run; not inspected in the audit.                                                       |
| Capsule experiments and reports                                                                                                            | In source     | `capsule` commands registered; the maintainer journey exists, not run in the audit.                    |
| Agent skills                                                                                                                               | Working       | `skills list` returns `blackbox`, `capsule`, `catalog`, `discovery`.                                   |
| Node instrumentation and OTLP collection                                                                                                   | In source     | Packages build; exercised indirectly by the run.                                                       |
| `blackbox onboarding start`                                                                                                                | **In review** | `blackbox onboarding start` fails with `command onboarding:start not found`. Not available yet.        |
| Effects snapshots (capture, accept, compare)                                                                                               | Roadmap       |                                                                                                        |
| Editable scaffold generator; Spec Kit extension                                                                                            | Roadmap       |                                                                                                        |
| Behavioral PR reports, impact planning                                                                                                     | Roadmap       |                                                                                                        |

## Documentation limits

- Install commands that use the `alpha` tag work only after the packages are published.
- The `blackbox feature` commands and the typed-client APIs are in source and were not run end to end in this audit.

## Run the bundled example from source

Prerequisites: Node.js 22.15 or later, pnpm 9.15.4, Docker with Compose (`docker info` must succeed), and network access
for images and dependencies on a fresh machine.

```sh
pnpm install --frozen-lockfile
pnpm build
cd e2e
pnpm exec blackbox catalog validate     # Catalog is valid ... Entries: 3
pnpm exec blackbox systems              # payment-mock, payment-mock-dist, subscription-system
```

The verification lane installs BLACKBOX into a throwaway consumer from a disposable local registry, as CI does.
Running the spec directly from the workspace does not work: `playwright test` in `e2e/` fails with `Stripping types
is currently unsupported for files under node_modules` on Node 25.8.1 and 22.23.3. Start the registry, publish the
built packages, then run the lane (from the repository root, after `pnpm build`):

```sh
storage="$(mktemp -d)"
docker run --detach --name blackbox-test-registry \
  --user "$(id -u):$(id -g)" --publish 127.0.0.1:4874:4873 \
  --volume "$(pwd)/.github/verdaccio/config.yaml:/verdaccio/conf/config.yaml:ro" \
  --volume "$storage:/verdaccio/storage" verdaccio/verdaccio:6.10.3

tarballs="$(mktemp -d)"
pnpm --recursive --filter './packages/*' exec pnpm pack --pack-destination "$tarballs"
for t in "$tarballs"/*.tgz; do
  env "npm_config_//127.0.0.1:4874/:_authToken=blackbox-e2e" \
    npm publish "$t" --registry http://127.0.0.1:4874/ --tag e2e --provenance=false
done

pnpm test:e2e:playwright
docker rm --force blackbox-test-registry
```

The lane is a maintainer acceptance script: besides the Playwright suite it runs an effects proof and Feature
checks. Details: [maintainer acceptance guide](../maintainers/docs/capsule-bash-e2e.md).

Without the registry the lane fails at once with `ECONNREFUSED 127.0.0.1:4874`. Artifacts are written to
`e2e/test-results/`. A one-command run that needs no registry does not exist yet.

## Prerequisites

- Node.js 22.15 or later; `@playwright/test >=1.61.0 <2` for the Playwright adapter.
- Docker with Compose for Sandbox execution. Catalog validation and skill installation do not start Docker.
- API-only tests need no browser download.

## Limits

- A passing run supports the assertions that ran under the observed conditions, not all behavior.
- Observations depend on instrumentation coverage. Missing or incomplete evidence stays inconclusive; an empty trace
  does not prove an operation never happened. Keep authoritative state checks alongside effects assertions.
- Node is the primary instrumented runtime.
- BLACKBOX is not a hardened sandbox for hostile code. See [SECURITY.md](../SECURITY.md).
