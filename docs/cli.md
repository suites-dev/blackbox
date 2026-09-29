# CLI reference

Use the CLI to configure an experiment, run commands, inspect observations, and read reports.
Run it from the directory containing your application's `blackbox.config.yaml`.

[Install the CLI](installation.md), then use command help to explore its options:

```sh
blackbox --help
blackbox capsule run --help
```

## Commands

| Command                                        | Purpose and main arguments                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capsule up [system]`                          | Start a capsule (the catalog default when `system` is omitted) and make it current. Optional `--title`, `--description`, repeated `--env KEY=VALUE`, and `--json`.            |
| `capsule run [--via <driver>] -- <command...>` | Run a command against a capsule and retain it as an activity. Optional `--session`, `--name`, `--purpose`, `--allow-untraced`, and `--json`.                                  |
| `capsule down [capsule-id]`                    | Stop a capsule and keep its evidence. Takes only a capsule ID; without one, the resolved capsule. Optional `--session` and `--json`.                                          |
| `capsule show <id>`                            | Show a capsule, activity or trace, running or stopped. Activity IDs accept a 6+ character prefix. Optional `--session` (search only that capsule) and `--json`.               |
| `capsule ls`                                   | List running capsules, newest first; `*` marks the current one. `--all` lists every retained capsule. Optional `--json`.                                                      |
| `capsule use <capsule-id>`                     | Make a capsule current, in any state. Optional `--json`.                                                                                                                      |
| `capsule report [capsule-id]`                  | Write the HTML and JSON report to `.blackbox/reports/`. `--format json\|html` writes one; `--output <path>` requires `--format`; `--output -` is JSON-only, without `--json`. |
| `capsule report serve`                         | Start or reuse the local report viewer. Shows the registry unless `--session <id>` names a capsule; opens a browser only with `--open`. Optional `--port`. No `--json`.       |
| `capsule report export`                        | Export a snapshot of an exact capsule, running or stopped. Requires `--session <id>` and `--format json\|html`. Optional `--output <path>`.                                   |
| `catalog ls`                                   | List catalog systems. Optional `--json`; does not start a system.                                                                                                             |
| `catalog validate`                             | Validate `blackbox.config.yaml` and referenced Compose/activation files. Optional `--json`.                                                                                   |
| `driver install --runtime node`                | Prepare `.blackbox/drivers/` and install the driver SDK. Optional `--json`. Does not install protocol tools.                                                                  |
| `inst install --runtime node`                  | Install `.blackbox/instrumentation/` and its pinned Node dependencies.                                                                                                        |

The capsule a command acts on is, in order: a positional capsule ID, `--session`, the `BLACKBOX_CAPSULE`
environment variable, then the current capsule in `.blackbox/state/current-capsule` (set by `capsule up` and
`capsule use`, cleared by `capsule down` only when it names the stopped capsule). The current capsule never
narrows ID search. Every suggested next command names its capsule explicitly.

`capsule report serve` is the exception: it never falls back to `BLACKBOX_CAPSULE` or the current capsule.
Without `--session` it shows the registry of all capsules.

## Exit codes

| Situation                                                                                          | Code      |
| -------------------------------------------------------------------------------------------------- | --------- |
| Success                                                                                            | `0`       |
| `capsule run`: the child exited with `N`                                                           | `N`       |
| `capsule run`: the child was killed by signal `S`                                                  | `128 + S` |
| `capsule run`: the executable was not found                                                        | `127`     |
| `capsule run`: any Blackbox failure, including usage and resolution errors                         | `125`     |
| Other commands: usage and resolution errors (flags, unknown or ambiguous IDs, no capsule selected) | `2`       |
| Other commands: Blackbox and capsule failures                                                      | `125`     |
| Reserved commands                                                                                  | `3`       |

`126` is reserved and not produced. A child can itself exit `125`, `126` or `127`, so the exit code alone
never proves where a failure came from: with `--json`, stdout carries exactly one JSON document for success
and for every failure, and that document is authoritative. A capsule failure keeps the Capsule package's
document (`capsule-not-found`, `capsule-invalid-state`, `capsule-operation-failed`) and adds the same
`capsule` and `next` fields as the matching success document. `catalog validate`, `driver install` and
`inst install` keep exiting `1` on failure.

`capsule up` and `capsule down` never undo a capsule that started or stopped because the current-capsule file
could not be written or cleared. They report it instead: a `blackbox:` line in human mode, a
`current-capsule-write-failed` entry in the JSON document's `warnings`, and exit `125`.

In human mode, Blackbox writes its own lines to stderr only. `capsule run` passes the child's stdout to
stdout and its stderr to stderr. A captured (non-terminal) run prints the retained output, which is
redacted and, above 1 MiB per stream, truncated to its first and last 512 KiB; the JSON envelope records
the retention.

`capsule up` accepts one of `--interactive`, `--non-interactive`, or `--silent`, plus `--no-color`.
Silencing terminal progress does not suppress retained progress records.

`capsule run --purpose` accepts `setup`, `stimulus`, or `inspection`, defaulting to `stimulus`. The purpose labels
intent; it does not make a command read-only. A driver (selected with `--via <name>`) determines host or
participant execution and reports its propagation result. `--allow-untraced` requires a driver and explicitly
permits an unmet propagation expectation.

When stdin and stdout are both terminals and `--json` is absent, `capsule run` uses interactive execution:
terminal input and command output are streamed, with the result retained as an activity. This is selected automatically;
there is no `capsule run --interactive` flag. A redirected or piped command uses captured execution. Use `--json` for
automation that needs the result envelope. The `capsule up` presentation flags above are a separate choice.

In `capsule run` JSON mode, delegated stdout/stderr belong inside the result envelope. A nonzero child exit remains
nonzero; a missing executable exits `127`. Observation queries return discriminated results: inspect `kind` and
telemetry status, not only the CLI exit code.

## Commands not available yet

With valid arguments, `setup init`, `skill install discovery`, and
`effects baseline update --run <id>` exit `3` with a not-implemented message. These reserved commands
are outside the [available alpha workflows](alpha-status.md).

See [Capsule experiments](experiments.md) for the sequence and [reports](reports.md) for viewing and exporting results.
