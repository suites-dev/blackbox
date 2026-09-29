# Resolve installed capabilities

Inspect the trusted installed executable's version, root help and relevant
command help. Keep a local capability record in source evidence: exact version,
command shapes, catalog schema identity, acquisition/activation/driver support,
and observed unsupported operations. Do not use an unpinned `npx` download to
perform capability detection.

## Known command profiles

Use only the profile actually implemented by the installation. These are mappings,
not permission to call every listed command.

| Operation | Earlier Alpha profile | Flat profile, only when available |
| --- | --- | --- |
| Validate catalog | `blackbox catalog validate --json` | Same |
| List systems | `blackbox catalog list --json` | `blackbox systems --json` |
| Acquire | `blackbox capsule start --system <entry> --json` | `blackbox up <entry> --json` |
| Execute | `blackbox capsule exec --session <id> --driver <driver> --purpose <purpose> --json -- <argv>` | `blackbox run --capsule <id> --via <driver> --purpose <purpose> --json -- <argv>` |
| Inspect | `blackbox observations --session <id> --json` | `blackbox show <id> --json` |
| Export | `blackbox capsule report export --session <id> --format json --output <path>` | `blackbox report <id> --format json --output <path>` |
| Release | `blackbox capsule stop --session <id> --json` | `blackbox down <id> --json` |

A driver flag is used only for an actual configured driver. The values
`setup`, `stimulus`, `inspection` describe intent, not side-effect guarantees.
Capture returned identities instead of inferring them from titles, time or a
current-session file. Parse the result discriminator and child result, not only
the shell status. Exact flags, aliases and JSON envelopes are version-dependent.

Commands such as `setup init`, a skill installer or an effects evaluator may be
reserved in an Alpha build. Registration is not implementation. Report unsupported
operations; this bundle does not introduce new Blackbox CLI commands.

## Catalog and runtime limits

The inspected Alpha config schema lives at
`packages/catalog/schema/blackbox-config-v1.json` in a source checkout. Consumers
must resolve the installed package's matching schema and semantic validator.
The config uses `schemaVersion`, `catalog`, and `activations`; entries include
`kind`, `acquisition`, `isolation`, `entrypoint`, `participants`, `drivers`, and
`observation`. The known acquisition adapter is `docker-compose@1`.

A string-valued protocol field does not establish a protocol-specific readiness
implementation. The inspected Alpha Capsule readiness path performs HTTP fetch.
A queue stimulus can work through a driver in a system with a real HTTP readiness
endpoint, but a genuinely queue-only system may require unsupported readiness
capability. Report that gap rather than introducing a fake API or fictional YAML.

Language-neutral discovery does not imply every language has a supported runtime
activation/exporter. Validate collector transport/encoding compatibility and actual
observation delivery separately from installation.

Source reference: [Alpha configuration documentation](https://github.com/suites-dev/blackbox/blob/3dc7e7180fe90ef5b36b42230d9f53b88f45df4a/docs/configuration.md).
