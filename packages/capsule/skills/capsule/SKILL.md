---
name: capsule
description: Exercise one accepted behavior inside a bounded Capsule and retain its terminal, observation and cleanup evidence.
---

# Live Capsule validation

Read [capabilities](references/capabilities.md),
[permissions](references/permissions.md) and the
[validation sequence](diagrams/capsule-sequence.mmd).

## Commands

Run them as `blackbox capsule <command>`. `up`, `run`, `show`, `down`, `ls`, `use` and `report` also exist
without `capsule`; `report export` and `report serve` exist only as `capsule report export|serve`, and
`systems` and `open` only without `capsule`. Check `--help` for anything not listed.

| Command         | Args                                    | Flags that matter                                                                                                                                                       | ID                                                                                                                                     |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `up`            | `[system]` (catalog default if omitted) | `--title`, `--description`, `--env KEY=VALUE` (repeatable), `--json`, `--non-interactive`                                                                               | Returns `sessionId` (also `capsule`); makes it current                                                                                 |
| `run`           | `-- <command...>`                       | `--via <driver>`, `--session <id>`, `--name`, `--purpose setup\|stimulus\|inspection` (default `stimulus`), `--wait <ms>`, `--allow-untraced`, `--raw-output`, `--json` | Takes a capsule ID (`--session`, else `BLACKBOX_CAPSULE`, else current); returns `activityId`                                          |
| `show`          | `<id>` (required)                       | `--session`, `--timeline`, `--spans`, `--full`, `--json`                                                                                                                | Takes a capsule, activity (6+ char prefix) or trace ID                                                                                 |
| `report`        | `[capsule]`                             | `--format html\|json`, `--output` (needs `--format`), `--json`                                                                                                          | Takes a capsule ID; writes under `.blackbox/reports/`                                                                                  |
| `report export` | none                                    | `--session <id>` and `--format html\|json` (both required), `--output` (`-` is JSON on stdout)                                                                          | Takes a capsule ID                                                                                                                     |
| `report serve`  | none                                    | `--session <id>`, `--port`, `--open`                                                                                                                                    | Takes a capsule ID; a newly started viewer stays up until Ctrl-C, but if one already owns the port the command exits at once           |
| `down`          | `[capsule]`                             | `--session`, `--json`                                                                                                                                                   | Takes a capsule ID; clears it as current; accepts `running`, `stop-failed` and `manager-failed` (a `start-failed` capsule is rejected) |
| `ls`            | none                                    | `--all` (include stopped), `--json`                                                                                                                                     | Lists capsule IDs                                                                                                                      |
| `systems`       | none                                    | `--json`                                                                                                                                                                | Lists the catalog systems to pass to `up`                                                                                              |

Find the `<system>` for `up` with `blackbox systems`. After `down`, confirm cleanup with
`blackbox capsule ls` (running only; the stopped capsule must be gone) and `ls --all` (still retained
as evidence). `use <id>` makes a capsule current, `open [id]` opens the viewer, and the hidden
`history` is `ls --all`; build no procedure on them. Always pass explicit IDs.

Use `up --json --non-interactive` in a terminal: interactive rendering omits the Compose project name from the progress.
It still prints a failed `up` document with `sessionId`, so check the exit code (0 and `kind: capsule-started`), not the ID.

After `down`, and after a failed `up` that reached `Compose configured: <project>`, confirm nothing is left (the
project is `composeProject` from the `up` JSON or that progress line; an earlier failure created none):

```sh
docker ps -a --filter "label=com.docker.compose.project=<project>" --format '{{.Names}}'
docker network ls --filter "label=com.docker.compose.project=<project>" --format '{{.Name}}'
docker volume ls -q --filter "label=com.docker.compose.project=<project>"
```

`ls` reads recorded state, not Docker.

`--allow-untraced` needs `--via`. Without it, a driver run is refused when trace-context injection
fails; with it the run proceeds untraced. Use it only when the task accepts that gap.

Never use `--raw-output`: it prints child output with credentials unredacted (see #140). Default
`--json` output is redacted. `--wait` is explained in [async](references/async-workflows.md).

## Procedure

1. Confirm explicit scope for code execution, local resource creation and any
   external service. Explain possible image pulls/builds, mounts, listeners and
   cleanup. Verify static preflight and a real terminal predicate first.
2. Acquire the selected entry with the installed command profile
   (`blackbox capsule up <system> --json`). Retain the returned Capsule/session ID
   (`sessionId`) from JSON, including any admitted failed startup.
   Never choose the newest session or rely on mutable current-Capsule state.
3. Observe supported readiness. Run migrations/seeding/reset as separate `setup`
   activities. Use unique data for each physical attempt.
4. Issue one deliberate `stimulus` through the appropriate driver. Retain actual
   activity identity, command envelope, child status and propagation outcome.
5. Run bounded `inspection` activities for the accepted terminal predicate. Use
   [async](references/async-workflows.md) for queues or delayed work. Do not repeat a
   non-idempotent stimulus to make a check pass.
6. Inspect the Capsule's observation scope as well as activity/trace scope. Check
   required observation sources independently from business completion. Preserve
   partial, unavailable and separately traced observations.
7. Stop the exact Capsule in a failure-safe cleanup path, then write the report
   (`down` drains the collector; a report written while it runs is `provisional`).
   Inspect owned-resource release with the Docker check below. A failed report must
   not skip cleanup, and a successful cleanup must not erase a failed experiment.
8. Link fresh records to the source revision, catalog digest, physical attempt,
   activities and business identifier. Return all stage outcomes independently.

## Return

Return execution findings and references to runner-owned raw records. Do not synthesize
successful receipts from prose. Cleanup failure can coexist with an operable
behavior; overall setup is still incomplete/failed. Leave unrelated resources and
old evidence untouched.

Read [the supported command procedure](references/capsule-experiments.md) before execution.
Use [runtime observation](references/runtime-observation.md) for capture gaps,
[evidence and reports](references/evidence-and-reports.md) for retained results,
[repair](references/troubleshooting-and-repair.md) for failures, and
[CI](references/ci.md) only for requested automation.

This skill can run independently. If Discovery delegates a task, return the
accepted boundary and predicate, exact session/activity identities, terminal and
observation findings, report location, cleanup outcome and remaining gaps. Do not
require Discovery to be installed to use Capsule.
