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
| `capsule show <id>`                            | Show a capsule, activity or trace, running or stopped. Activity IDs accept a 6+ character prefix. Optional `--session`, `--spans` (trace), `--timeline` (capsule), `--json`.  |
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
| `capsule run`: the host refused to execute the file (no execute permission)                        | `126`     |
| `capsule run`: the executable was not found                                                        | `127`     |
| `capsule run`: any Blackbox failure, including usage and resolution errors                         | `125`     |
| Other commands: usage and resolution errors (flags, unknown or ambiguous IDs, no capsule selected) | `2`       |
| Other commands: Blackbox and capsule failures                                                      | `125`     |
| Reserved commands                                                                                  | `3`       |

A child can itself exit `125`, `126` or `127`, so the exit code alone
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

## Reading `capsule show`

`capsule show <activity>` names the activity by its short ID and name; it never prints the command line, which
can hold credentials. It reports how the command ran (`via`, `process`), what happened to its trace
context (`context`), and what the capsule observed:

| `context`                                                            | Meaning                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `sent (w3c, <carrier>)`                                              | The driver injected W3C trace context.                                          |
| `not carried: <resource> is shared state (expected for this driver)` | The command writes shared state (Redis, a database): nothing can carry context. |
| `untraced: no driver, so no trace context was sent`                  | A raw host command; no driver carried context.                                  |
| `not sent: driver <driver> declares no propagation`                  | The driver does not propagate context.                                          |
| `injection failed: <message>`                                        | The driver tried and failed.                                                    |

`SPANS` is the tree of the activity's own trace: every span whose trace ID is the activity's context
trace ID, nested only by each span's recorded parent. A root whose parent is absent ends with
`(parent not yet observed)` while the capsule runs, or `(parent not retained)` once it has stopped.
Siblings are ordered by start time, then service, then title, then span ID. `capsule show <trace> --spans`
lists the same spans as rows with their span and parent IDs.

Only trace context links an activity to what it caused. Every other trace in the capsule whose
first span started at or after the activity started is listed under `later in this capsule, no known
cause`, with a `⚠ Blackbox cannot prove that …` line: it happened in the same capsule, but no trace
context connects it to the activity. Earlier traces, and traces without a start time, are not listed
there. `capsule show <capsule> --timeline` places each uncaused trace after the latest activity that
started at or before its first span, or before every activity when none did (`┈┈`), and marks
traces an activity caused with `──`. Placement is display order only, never a cause. Traces from
before the first activity (instrumentation start-up, readiness probes) are summarized in one row; the
JSON timeline keeps one row per trace.

Every observation carries a status. Blackbox never claims to have seen everything while a capsule runs:

| Status                          | When                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `provisional (capsule running)` | The capsule is starting, running or stopping; more telemetry may still arrive.                                                          |
| `complete`                      | The capsule stopped and every collector run drained and stopped without a failure.                                                      |
| `incomplete (<reason>)`         | The capsule stopped but the collector timed out, was interrupted, failed, left no record or did not stop, or the capsule itself failed. |

A trace ID that no capsule retains is `id-unknown` (exit `2`), except when an explicit capsule
(`--session` or `BLACKBOX_CAPSULE`) is still provisional: then `capsule show` exits `0` with
`not observed yet · provisional (capsule running)`, because its spans may simply not have arrived.
In JSON, every `capsule show` document carries `status`, and `reason` when the status is `incomplete`.
`--timeline` exits `125` when the capsule's activity record cannot be read, rather than placing every
trace as if there were no activities.

Span titles print an HTTP span's route template when the service reports one. A title built from a
raw request path keeps only short lowercase words (each at most 16 letters) and short versions such as
`v1`; every other segment prints as `{…}`, so IDs and tokens in paths are not shown. Names, titles and services from telemetry are written
to the terminal without control characters or escape sequences.

`capsule show` output never uses the words success, successful, passed, verified, effect or effects: it reports
what was observed, not whether the system behaved correctly.

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
nonzero; a missing executable exits `127`, and a host file without execute permission exits `126`. Observation queries return discriminated results: inspect `kind` and
telemetry status, not only the CLI exit code.

## Commands not available yet

With valid arguments, `setup init` and `effects baseline update --run <id>` exit
`3` with a not-implemented message. `skill install discovery` is implemented by
the Skills plugin and accepts `--codex`, `--claude`, `--cursor`, repeated
`--agent <name>`, `--yes`, and `--json`.

See [Capsule experiments](experiments.md) for the sequence and [reports](reports.md) for viewing and exporting results.
