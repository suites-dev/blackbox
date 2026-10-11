# Availability and compatibility

Use this page before copying an example. Install compatible Blackbox packages
from the `alpha` channel and use documentation for the same release.
Commit the resolved versions in your lockfile.

## Release capabilities

| Surface           | What you can use                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding        | Guided agent setup and application preparation through `blackbox onboarding start`.                                                         |
| Native Playwright | `test.system`, `system.sandbox`, normal Playwright fixtures, and a fresh Sandbox per physical attempt, including retries.                   |
| Effects           | Project OTLP observations into effects, evaluate behavioral contracts, and serialize experimental effects records for review.               |
| Reporting         | Native Playwright reports plus `blackbox-progress`, `blackbox-attempt`, and `blackbox-diagnostics` attachments. Optional attempt retention. |
| Catalog           | Load, list, and validate a project-owned `blackbox.config.yaml`.                                                                            |
| Capsule           | Start a configured system, run commands or project drivers, inspect observations, export or serve reports, and stop the system.             |
| Agent skills      | List and copy skills contributed by installed, selected packages.                                                                           |
| Instrumentation   | Node activation and raw telemetry collection where configured.                                                                              |

Start with [package installation](installation.md) and [the first test](getting-started.md).

## Candidate APIs outside this branch

The candidate implementation inspected in Git history at
`12562aed5a9fc579785f95ab2d722ea3b2dbd894`
contains `defineClient`, the typed `clients` registry, the injected `step` fixture,
and the HTTP Feature compiler. These exports and commands are absent from this
checkout. Refer to that revision when evaluating the candidate documentation;
its presence in Git history does not make it available to the current build.

| Candidate documentation                                      | Additional requirement                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Client definitions](playwright/clients-and-fixtures.md)     | A build containing the candidate Playwright client API.                                                                                                           |
| [Feature compilation](features/reference.md)                 | The candidate Feature package selected in the CLI composition.                                                                                                    |
| [Product-cache case study](guides/verify-a-specification.md) | A product application, fixture endpoints, and observers described by the case study. Those sample files are not included here or in the cited candidate revision. |

The source tree does include a separate subscription/payment application under
[`e2e/`](../e2e/). Maintainers can use
[the acceptance guide](../maintainers/docs/capsule-bash-e2e.md) to prepare that harness.

## Not implemented

- Automatic Feature drafting and completed-run Feature verification; candidate routes are reserved but unavailable.
- An editable Playwright scaffold generator.
- A Spec Kit extension or a `.state.yaml` contract.
- Direct execution of Feature files inside a Capsule.

The `effects` fixture and `toSatisfy` matcher evaluate the selected runtime
observations against effect contracts. Missing or incomplete evidence remains
inconclusive; an empty trace cannot establish that an operation never occurred.
Keep authoritative state checks alongside [effects assertions and records](contracts/effects-snapshots.md).

[Design proposals](design/README.md) describe future work without installation promises.

## Runtime prerequisites

Blackbox requires Node.js 22.15 or later. The Playwright adapter requires
`@playwright/test >=1.61.0 <2`.
Docker with Compose is needed for Sandbox execution. Static catalog validation
and skill installation do not start Docker.

Recheck this page when exports, commands, package composition, or release availability change.
