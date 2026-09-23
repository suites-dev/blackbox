# `@suites/blackbox-cli`

The CLI is the facade that guides Blackbox through three phases: **Sandboxes**, **Testing**, and **Assurance**.

The CLI composes the Catalog, Capsule, and report-server packages. Catalog
inspection, Capsule acquisition and execution, and Capsule JSON/HTML/served
reports are available now. Playwright and assurance routes remain fail-closed
until their phase backends exist. A command that has no backend exits with code
`3`; it never reports a fabricated success or artifact.

Capsule reports have two explicit actions:

```text
blackbox capsule report serve --open
blackbox capsule report serve --session <id> --open --port 8080
blackbox capsule report export --session <id> --format html
blackbox capsule report export --session <id> --format json
blackbox capsule report export --session <id> --format json --output -
```

Exports default to `.blackbox/reports/capsule-<id>/capsule-report.<format>`.
The CLI creates the destination directory and prints the generated path.
`--output <path>` overrides it. `--output -` writes the JSON report document
itself to stdout, without an envelope, path, or progress messages. Export errors
use stderr and a nonzero exit code. `--format` is required.

The served mode is a local read-only registry on port `4310` by default. Repeated
serves for the same project and provider reuse the existing viewer and announce
`Viewer ownership: reused`; the reused caller does not own or stop that process.
Use `--port 0` only for deliberately isolated test runs. It polls summaries and the selected
report every second, updating the report only when the rendered snapshot changes.
Failed updates leave an explicit stale/unavailable message; the viewer retries.
Progress records appear as they are retained; command activities currently appear
when commands finish, not as a live stdout/stderr stream. Lifecycle states are
recorded states, not a heartbeat proving the manager is alive.

`--open` launches the default browser after the listener is ready, including when
an existing viewer is reused. If the browser
cannot open, the CLI prints a warning and keeps serving the announced URL.
Ctrl-C or SIGTERM stops only a viewer started by that invocation, never the Capsule.
Closing a browser tab does not stop the server. Stop the owning viewer explicitly
in its terminal.

The former `capsule report --serve`, `--html`, and `--json` forms have been replaced
by these subcommands. `capsule report` displays help for both actions.

`capsule exec -- <command>` preserves the delegated command. Host execution is the default. A participant container is
selected only with `--participant <name>`.
