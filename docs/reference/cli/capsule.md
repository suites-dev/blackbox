# Capsule commands

Use explicit `blackbox capsule ...` commands in instructions and scripts. Root aliases exist, but a single spelling makes retained procedures easier to follow.

## Acquire

```sh
blackbox capsule up subscription-system --json
```

Omit the system argument to select the catalog default. Supported options include `--title`, `--description`, repeatable `--env KEY=VALUE`, `--json`, `--interactive`, `--non-interactive`, `--silent`, and `--no-color`.

Retain the returned session identity, including an admitted failed startup. Startup history is not a live manager heartbeat. Avoid secrets in command-line arguments and exported shell history.

## Run an activity

```sh
blackbox capsule run --session <id> --via public-api \
  --purpose stimulus --name health --json -- curl --fail-with-body /health
```

The driver name is project-defined. Without `--via`, the command runs on the host. The command after `--` is the delegated executable and arguments, not a Blackbox subcommand.

| Option | Meaning |
| --- | --- |
| `--session <id>` | Exact Capsule; omission uses `BLACKBOX_CAPSULE`, then mutable current selection |
| `--via <driver>` | Use the selected Catalog driver |
| `--purpose setup\|stimulus\|inspection` | Retained label; default `stimulus`, not an access restriction |
| `--name <name>` | Human-readable activity name |
| `--wait <ms>` | Bounded telemetry wait after child exit; default 5000, 0 disables that wait |
| `--allow-untraced` | Explicit propagation override; retain the limitation |
| `--json` | Structured result |
| `--raw-output` | With JSON, bypass credential redaction for captured child output; avoid in shared artifacts |

The child exit is passed through; Blackbox failures exit `125`. Neither a successful child nor the telemetry wait establishes downstream business completion.

## Inspect

```sh
blackbox capsule show --session <id>
blackbox observations --session <id>
```

The `ls`, `use`, `systems`, and `history` surfaces support navigation. Agents should prefer known identities over mutable selection. Inspect each installed command's `--help` for supported filtering and output flags rather than reusing flags from another command.

## Report

```sh
blackbox capsule report serve --session <id>
blackbox capsule report export --session <id> --format html
blackbox capsule report export --session <id> --format json
```

`blackbox capsule report <id>` writes both formats under `.blackbox/reports/`. A rendered report is a projection of retained evidence, not a behavioral verdict by itself.

## Stop

```sh
blackbox capsule down --session <id>
```

Stop the exact owned environment and inspect cleanup. Retained experiment records remain. Export/report failures must not prevent cleanup; cleanup success must not erase failed checks.

There are no audited `capsule curl`, `capsule checkpoint`, or `capsule effects` commands. Use supported activities and observations instead.

## Source contract

[Registry](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/src/cli/command-registry.ts). [Run flags](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/src/cli/commands/capsule/run.ts). [Up flags](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/src/cli/commands/capsule/up.ts). [Procedure](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/references/capsule-experiments.md).

---

[Documentation](../../README.md)
