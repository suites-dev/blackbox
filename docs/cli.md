# CLI reference

Use the CLI to configure an experiment, run commands, inspect observations, and read reports.
Run it from the directory containing your application's `blackbox.config.yaml`.

[Install Blackbox](installation.md), then use command help to explore its options.
The main package includes `catalog` and `skills`; Capsule, driver, and runtime
instrumentation commands require their separately selected packages:

```sh
blackbox --help
blackbox capsule run --help
```

## Commands

| Command                                        | Purpose and main arguments                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capsule up [system]`                          | Start a capsule (the catalog default when `system` is omitted) and make it current. Optional `--title`, `--description`, repeated `--env KEY=VALUE`, and `--json`.            |
| `capsule run [--via <driver>] -- <command...>` | Run a command against a capsule, retain it as an activity, and show its telemetry. Optional `--session`, `--name`, `--purpose`, `--allow-untraced`, `--wait`, `--json`.       |
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
| `skills list`                                  | List skills contributed by selected Blackbox plugins. `--json` also reports availability of optional integrations.                                                            |
| `skills install <name>`                        | Install a contributed skill for one or more project-local agent hosts. Supports host flags, repeated `--agent`, `--yes`, and `--json`.                                        |

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
`capsule` and `next` fields as the matching success document. `catalog validate`, `driver install`,
`inst install` and `skills install` exit `1` on failure; `skills install` reports every destination first.

`capsule up` and `capsule down` never undo a capsule that started or stopped because the current-capsule file
could not be written or cleared. They report it instead: a `blackbox:` line in human mode, a
`current-capsule-write-failed` entry in the JSON document's `warnings`, and exit `125`.

In human mode, Blackbox writes its own lines to stderr only. `capsule run` passes the child's stdout to
stdout and its stderr to stderr. A captured (non-terminal) run prints the retained output, which is
redacted and, above 1 MiB per stream, truncated to its first and last 512 KiB; the JSON envelope records
the retention.

## Reading `capsule run`

After the child exits, `capsule run` waits for its telemetry, then prints one block on stderr after the
child's own output (the child's exit code is passed through unchanged):

```text
activity 6070297f · capsule steady-comet-zoe-486137236234 · stimulus · via public-api · host · exit 0 · 277ms
  context   sent (w3c, http-headers)
  observed  1 traces · 4 services · 19 spans · provisional (capsule running)
    public-api  POST /subscriptions  201
    ├─ public-api  GET
    ├─ public-api  pg-pool.connect
    ├─ public-api  pg.query:SELECT subscriptions
    ├─ public-api  SET
    ├─ fraud-check  POST /assess  200
    │  ├─ fraud-check  pg-pool.connect
    │  └─ fraud-check  pg.query:INSERT subscriptions
    ├─ public-api  SET
    ├─ public-api  GET
    ├─ payment-mock  POST /v1/payment_intents  201
    ├─ order-service  POST /orders  201
    │  └─ order-service  subscription-orders  200
    ├─ public-api  pg-pool.connect
    └─ public-api  pg.query:INSERT subscriptions
→ blackbox capsule show 6070297f --session steady-comet-zoe-486137236234
```

The first line is the run line (never the command line). `context`, the status and the uncaused-trace
lines read exactly as in `capsule show <activity>` (below); a capsule that is running is always
`provisional`. The tree is shorter than `show`'s: it keeps server, consumer and producer spans, and client
spans that call a database, message system or RPC system (`db.system`, `db.system.name`,
`messaging.system` or `rpc.system`); a kept span hangs under its nearest kept ancestor. At most 40 tree
lines are printed, then `… <n> more spans`; `capsule show <activity>` prints every span. With nothing
observed yet the block says `observed  nothing yet · <status>`. A driver that failed before any process
existed prints the `not run` line and its message only.

The wait polls the collector every 150 ms and ends once no new span has arrived for 750 ms, or after
`--wait <ms>` (default `5000`). `--wait 0` prints what has arrived without waiting; a negative or
non-integer value is a usage error (`125`). When the limit ends the wait while spans are still arriving,
the block adds `⚠ spans were still arriving when the wait ended after <duration>.`. Ctrl-C during the
wait stops waiting and prints the block as it stands; the exit code is still the child's. On a terminal
the block is drawn when the child exits and redrawn in place as spans arrive; otherwise it is printed once.

With `--json`, `capsule run` waits the same way and prints one `capsule-exec-completed` document. It adds
the `context`, `observation` and `limitations` of `capsule show <activity> --json` (the JSON tree keeps
every span kind), with `observation.waitedMs` and `observation.stillArriving`, and a `still-arriving`
limitation (`waitedMs`) when the limit ended the wait. A driver failure before any process existed adds
nothing. `capsule show <activity> --json` reports `waitedMs: 0` and `stillArriving: false`.

The command line can carry credentials, so the argv in the document (`outcome.argv`, or
`outcome.process.argv` for a driver) is redacted exactly as the report redacts it: `Bearer`/`Basic`
credentials, `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` and `Api-Key`
header values, `user:password@` in URLs, secret query parameters (`token`, `secret`, `password`,
`api_key`, …), `NAME=value` assignments, the value after a sensitive flag (`--token value`), and every
position the driver declares become `[REDACTED]`. `argv[0]`, the executable, is always kept, and the
field keeps its name, place and type (a string array). Only what is printed changes: the retained
activity record keeps the command as run, and the report redacts it when rendered.

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

`capsule run` and `capsule show` output never uses the words success, successful, passed, verified, effect or effects: it reports
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

With valid arguments, `setup init` and `effects baseline update --run <id>` exit `3` with a
not-implemented message. These reserved commands are outside the
[available alpha workflows](alpha-status.md).

`skills install` resolves only skills contributed by selected plugins. Required
skill dependencies are included; optional integrations are reported by
`skills list --json` and are never installed automatically. The singular
`skill install <name>` spelling remains an alias.

Start with `blackbox skills install blackbox --codex --gitignore` to copy the
main package's entry skill into `.agents/skills/blackbox/`. Use `--cursor` for the same
destination or `--claude` for `.claude/skills/blackbox/`. The optional `--gitignore`
flag ignores successful copies. After host discovery, `$blackbox` provides
orientation and routes to available package skills; it does not auto-install its
optional Discovery, Catalog, or Capsule skill copies. The main package selects the
Skills installer, Discovery, and Catalog by default; Capsule stays separate.
See [agent-guided adoption](../packages/blackbox/README.md#start-with-the-agent-skill).

See [Capsule experiments](experiments.md) for the sequence and [reports](reports.md) for viewing and exporting results.
