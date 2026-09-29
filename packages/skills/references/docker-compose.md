# Docker, Compose and Testcontainers

Use the project's selected, ordered `-f` files, profiles and working directory.
Inspect installed help before choosing flags. "Does not start containers" is not
synonymous with "does not read secrets, fetch content or execute helpers".

## Command guide

| Probe | Purpose | Effects and cautions |
| --- | --- | --- |
| `docker compose version`, `docker compose --help` | Installed command capability | Trusted CLI execution; no application start |
| `docker compose -f compose.yaml config -q` | Validate the Compose model | Parses/resolves inputs; inspect includes and environment references first; warnings can contain sensitive text |
| `... config --services`, `--profiles`, `--images`, `--networks`, `--volumes` | Declared model inventory | Names are not runtime instances; interpolation/include resolution still matters |
| `... config --format json --no-interpolate --no-env-resolution` | Inspect merged structure with less environment expansion | Flags reduce expansion, not guarantee redaction; literal secrets/defaults can remain |
| `... config --variables` | Variable names and defaults | Defaults may be secrets; never forward raw output |
| `... config --environment` | Interpolation environment | Can print secret values; do not use as a default discovery probe |
| `... config --resolve-image-digests` or `--lock-image-digests` | Resolve immutable image identity | Registry access and output writes may be involved; separately authorized |
| `docker compose --dry-run -f compose.yaml up --build -d` | Show an execution plan | Does not establish runtime success; review inputs and installed semantics first |
| `docker context show`, scoped context inspect | Identify daemon target | Can reveal endpoints; verify local vs remote before daemon access |
| `docker info`, scoped `compose ps --format json`, `compose port` | Daemon/runtime inspection | Contacts the selected daemon; may address a remote host |
| Scoped `docker inspect`, `compose logs`, `compose events` | Runtime state/diagnostics | Can expose environments/payloads; scope, bound and redact before retention |
| `compose pull`, `build`, `create`, `up`, `run`, `exec` | Acquire or execute | Pull/build can execute build steps; create changes resource state even before startup |
| `compose down` | Release a known project | Only an owned project with recorded resources; never global prune or shared-resource deletion |

Do not use `--no-consistency` to obtain a green configuration check. Preserve the
first Compose file's path-resolution context and the exact order of overrides.
Profiles and explicitly targeted services affect the selected set; do not assume
all profiled services or every sibling service will start.

## Startup and readiness

`depends_on` describes ordering/dependencies, not the full behavioral path. Short
syntax does not establish application readiness. `service_healthy` depends on the
configured health check; `service_completed_successfully` can model a one-shot
setup dependency. Health checks must be about an actual readiness condition, not a
fixed sleep or mere process existence. Startup checks remain distinct from the
experiment's terminal condition.

Keep container ports distinct from host publications. Use service DNS inside the
network and loopback-only host publications with dynamically assigned ports where
supported. Read actual mapped endpoints after acquisition. Review host networking,
Docker socket access, fixed container names, external networks and shared volumes.

## Use the existing Capsule acquisition path

Testcontainers' Compose support and wait strategies can support runtime acquisition,
health/HTTP/log/port checks and one-shot tasks. Those capabilities are not
necessarily exposed by the installed Blackbox schema. Do not instantiate a second
independent Testcontainers environment alongside the Capsule and call it Capsule
validation. Use the Capsule/Sandbox lifecycle and retain its ownership receipts.

Pulls/builds/container creation belong to live validation even when internally
called "pre-start inspection". On failure, cleanup must include partially acquired
owned resources without touching preexisting images or another project's state.

Sources: [Compose config](https://docs.docker.com/reference/cli/docker/compose/config/),
[Compose CLI and dry run](https://docs.docker.com/reference/cli/docker/compose/),
[startup order](https://docs.docker.com/compose/how-tos/startup-order/),
[networking](https://docs.docker.com/compose/how-tos/networking/),
[profiles](https://docs.docker.com/compose/how-tos/profiles/),
[Compose trust model](https://docs.docker.com/compose/trust-model/),
[Testcontainers Compose](https://node.testcontainers.org/features/compose/),
[wait strategies](https://node.testcontainers.org/features/wait-strategies/).
