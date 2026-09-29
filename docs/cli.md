# CLI reference

Use the CLI to configure an experiment, run commands, inspect observations, and read reports.
Run it from the directory containing your application's `blackbox.config.yaml`.

[Install the CLI](installation.md), then use command help to explore its options:

```sh
blackbox --help
blackbox capsule exec --help
```

## Commands

| Command                                | Purpose and main arguments                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `up [system]`                          | Start a capsule (the catalog default when `system` is omitted) and make it current. Optional `--title`, `--description`, repeated `--env KEY=VALUE`, and `--json`.            |
| `run [--via <driver>] -- <command...>` | Run a command against a capsule and retain it as an activity. Optional `--capsule`, `--name`, `--purpose`, `--allow-untraced`, and `--json`.                                  |
| `down [capsule-id]`                    | Stop a capsule and keep its evidence. Takes only a capsule ID; without one, the resolved capsule. Optional `--capsule` and `--json`.                                          |
| `show <id>`                            | Show a capsule, activity or trace, running or stopped. Activity IDs accept a 6+ character prefix. Optional `--capsule` (search only that capsule) and `--json`.               |
| `ls`                                   | List running capsules, newest first; `*` marks the current one. `--all` lists every retained capsule. Optional `--json`.                                                      |
| `use <capsule-id>`                     | Make a capsule current, in any state. Optional `--json`.                                                                                                                      |
| `open [id]`                            | Start or reuse the local viewer and open the browser, on the given or current capsule, else on all capsules. Optional `--port`, `--no-browser`, and `--json`.                 |
| `report [capsule-id]`                  | Write the HTML and JSON report to `.blackbox/reports/`. `--format json\|html` writes one; `--output <path>` requires `--format`; `--output -` is JSON-only, without `--json`. |
| `systems`                              | List catalog systems. Optional `--json`; does not start a system.                                                                                                             |
| `catalog validate`                     | Validate `blackbox.config.yaml` and referenced Compose/activation files. Optional `--json`.                                                                                   |
| `driver install --runtime node`        | Prepare `.blackbox/drivers/` and install the driver SDK. Optional `--json`. Does not install protocol tools.                                                                  |
| `inst install --runtime node`          | Install `.blackbox/instrumentation/` and its pinned Node dependencies.                                                                                                        |

The capsule a command acts on is, in order: a positional capsule ID, `--capsule`, the `BLACKBOX_CAPSULE`
environment variable, then the current capsule in `.blackbox/state/current-capsule` (set by `up` and `use`,
cleared by `down` only when it names the stopped capsule). The current capsule never narrows ID search.
Every suggested next command names its capsule explicitly.

## Exit codes

| Situation                                                                                          | Code      |
| -------------------------------------------------------------------------------------------------- | --------- |
| Success                                                                                            | `0`       |
| `run`: the child exited with `N`                                                                   | `N`       |
| `run`: the child was killed by signal `S`                                                          | `128 + S` |
| `run`: the executable was not found                                                                | `127`     |
| `run`: any Blackbox failure, including usage and resolution errors                                 | `125`     |
| Other commands: usage and resolution errors (flags, unknown or ambiguous IDs, no capsule selected) | `2`       |
| Other commands: Blackbox and capsule failures                                                      | `125`     |
| Reserved commands                                                                                  | `3`       |

`126` is reserved and not produced. A child can itself exit `125`, `126` or `127`, so the exit code alone
never proves where a failure came from: with `--json`, stdout carries exactly one JSON document for success
and for every failure, and that document is authoritative. A capsule failure keeps the Capsule package's
document (`capsule-not-found`, `capsule-invalid-state`, `capsule-operation-failed`) and adds the same
`capsule` and `next` fields as the matching success document. `catalog validate`, `driver install` and
`inst install` keep exiting `1` on failure.

`up` and `down` never undo a capsule that started or stopped because the current-capsule file could not be
written or cleared. They report it instead: a `blackbox:` line in human mode, a `current-capsule-write-failed`
entry in the JSON document's `warnings`, and exit `125`.

In human mode, Blackbox writes its own lines to stderr only. `run` passes the child's stdout to stdout and
its stderr to stderr. A captured (non-terminal) run prints the retained output, which is redacted and, above
1 MiB per stream, truncated to its first and last 512 KiB; the JSON envelope records the retention.

## Earlier command names

These names still work, hidden from help, with the argument shapes they always had. Human output and exit
codes follow the new commands; JSON documents keep every earlier field and add `capsule` and `next`.

| Earlier invocation                                          | Now                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `capsule start --system X`                                  | `up X`                                               |
| `capsule exec --session X [--driver D] -- <command>`        | `run --capsule X [--via D] -- <command>`             |
| `capsule stop --session X`                                  | `down X`                                             |
| `observations --session X [--activity A \| --trace T]`      | `show X`, `show A --capsule X`, `show T --capsule X` |
| `capsule report serve [--session X] [--open] [--port N]`    | `open`; the browser opens only with `--open`         |
| `capsule report export --session X --format F [--output P]` | `report X --format F [--output P]`                   |
| `catalog list`                                              | `systems`                                            |
| `history`                                                   | `ls --all`                                           |

Changes from the earlier behavior: capsule failures exit `125` instead of `1` (report export write failures
instead of `4`); a signaled child exits `128 + S` instead of `1`; `capsule exec` usage errors exit `125`
instead of `2`; `capsule exec` on a capsule that is not running reports `capsule-not-running`; and
`observations` with an ID that is not retained reports `id-unknown` (exit `2`).

`capsule start` accepts one of `--interactive`, `--non-interactive`, or `--silent`, plus `--no-color`.
Silencing terminal progress does not suppress retained progress records.

`capsule exec --purpose` accepts `setup`, `stimulus`, or `inspection`, defaulting to `stimulus`. The purpose labels
intent; it does not make a command read-only. A driver determines host or participant execution and reports its
propagation result. `--allow-untraced` requires a driver and explicitly permits an unmet propagation expectation.

When stdin and stdout are both terminals and `--json` is absent, `capsule exec` uses interactive execution:
terminal input and command output are streamed, with the result retained as an activity. This is selected automatically;
there is no `capsule exec --interactive` flag. A redirected or piped command uses captured execution. Use `--json` for
automation that needs the result envelope. The `capsule start` presentation flags above are a separate choice.

In exec JSON mode, delegated stdout/stderr belong inside the result envelope. A nonzero child exit remains nonzero;
a missing executable exits `127`. Observation queries return discriminated results: inspect `kind` and telemetry
status, not only the CLI exit code.

## Commands not available yet

With valid arguments, `setup init`, `skill install discovery`, and
`effects baseline update --run <id>` exit `3` with a not-implemented message. These reserved commands
are outside the [available alpha workflows](alpha-status.md).

See [Capsule experiments](experiments.md) for the sequence and [reports](reports.md) for viewing and exporting results.
