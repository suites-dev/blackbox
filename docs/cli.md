# CLI reference

Use the CLI to configure an experiment, run commands, inspect observations, and read reports.
Run it from the directory containing your application's `blackbox.config.yaml`.

[Install the CLI](installation.md), then use command help to explore its options:

```sh
blackbox --help
blackbox capsule exec --help
```

## Commands

| Command                                                    | Purpose and main arguments                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `catalog validate`                                         | Validate `blackbox.config.yaml` and referenced Compose/activation files. Optional `--json`.                      |
| `catalog list`                                             | List catalog entries. Optional `--json`; does not start a system.                                                |
| `driver install --runtime node`                            | Prepare `.blackbox/drivers/` and install the driver SDK. Optional `--json`. Does not install protocol tools.     |
| `inst install --runtime node`                              | Install `.blackbox/instrumentation/` and its pinned Node dependencies.                                           |
| `capsule start --system <id>`                              | Acquire a system. Optional `--title`, `--description`, repeated `--env KEY=VALUE`, and `--json`.                 |
| `capsule exec --session <id> -- <command>`                 | Run a host command. Optional `--name`, `--driver`, `--purpose`, `--allow-untraced`, and `--json`.                |
| `observations --session <id>`                              | Read raw retained observations. Optional `--activity <id>` or `--trace <id>` (mutually exclusive), and `--json`. |
| `capsule stop --session <id>`                              | Stop the owned environment and retain the experiment. Optional `--json`.                                         |
| `capsule report serve`                                     | Start or reuse the local viewer. Optional `--session <id>`, `--open`, and `--port <number>`.                     |
| `capsule report export --session <id> --format json\|html` | Export a snapshot. Optional `--output <path>`; `--output -` is JSON-only.                                        |

`capsule start` accepts one of `--interactive`, `--non-interactive`, or `--silent`, plus `--no-color`.
Silencing terminal progress does not suppress retained progress records.

`capsule exec --purpose` accepts `setup`, `stimulus`, or `inspection`, defaulting to `stimulus`. The purpose labels
intent; it does not make a command read-only. A driver determines host or participant execution and reports its
propagation result. `--allow-untraced` requires a driver and explicitly permits an unmet propagation expectation.

In exec JSON mode, delegated stdout/stderr belong inside the result envelope. A nonzero child exit remains nonzero;
a missing executable exits `127`. Observation queries return discriminated results: inspect `kind` and telemetry
status, not only the CLI exit code.

## Commands not available yet

With valid arguments, `setup init`, `skill install discovery`, `report`, `history`, and
`effects baseline update --run <id>` exit `3` with a not-implemented message. These reserved commands
are outside the [available alpha workflows](alpha-status.md).

See [Capsule experiments](experiments.md) for the sequence and [reports](reports.md) for viewing and exporting results.
