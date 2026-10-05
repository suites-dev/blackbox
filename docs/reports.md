# Read Capsule reports

Capsule reports show the retained record of work performed in the environment: session details, lifecycle and startup
progress, activities, observation summaries, and cleanup or failure information. Use them while a Capsule is running or after it stops.

A report can contain evidence from an exploratory investigation or a trial with explicit expectations. Exporting it
does not accept observed behavior as correct or assign a claim verdict. See [the verification model](verification-machine.md).

## Open the local viewer

From the Capsule's project directory, with the [CLI installed](installation.md):

```sh
blackbox capsule report serve --open
blackbox capsule report serve --session "$SESSION_ID" --open
```

The viewer binds to `127.0.0.1:4310` by default and prints its URL. Select a session in the registry or use
`--session` to open one directly. `--port` selects another port; a conflicting unrelated listener is reported,
not stopped or silently bypassed.

Repeated serves for the same project and provider reuse the viewer. The CLI prints `Viewer ownership: started`
or `Viewer ownership: reused`. Only the invocation that started the viewer owns its shutdown. Ctrl-C there stops
the viewer; Capsules keep running. Closing a browser tab does not stop either process.

The viewer polls retained records every second. Startup progress appears as it is recorded. Command activities
currently appear when commands finish; the viewer does not stream unfinished stdout/stderr. A stale/unavailable
message indicates a failed update. A recorded running state is not a heartbeat proving a Capsule manager is alive.

## Export a snapshot

```sh
blackbox capsule report export --session "$SESSION_ID" --format html
blackbox capsule report export --session "$SESSION_ID" --format json
blackbox capsule report export --session "$SESSION_ID" --format json --output -
```

Default exports go to `.blackbox/reports/capsule-<session-id>/capsule-report.html` or `capsule-report.json`.
The command prints the file path. `--output <path>` overrides it; JSON `--output -` writes the document itself to
stdout. Format is required.

Exports redact credentials when they are written; the experiment directory they are made from does not (see
[Reading `capsule run`](cli.md#reading-capsule-run)), so share exports rather than `.blackbox/experiments/`.

Exports are snapshots. An HTML export made while running stays a running snapshot after stop. Export again to
capture the stopped state, choosing a different output path if you want to retain both versions. Serving and exporting
read retained evidence without changing the experiment.

## What a report records

- **When it was written.** `generatedAt` is the snapshot time, and the HTML names it. A report written
  while the capsule ran says it was running when the snapshot was generated. A report written after
  `capsule down` includes the stop in its progress (`capsule-stop-requested`, `capsule-stopped`), and each
  participant that `ls`, `show`, `run` or `down` saw exit (`participant-exited`, with its exit code).
  `session.updatedAt` is the latest retained change: the record, an activity, or a progress event.
- **The observation policy.** `observationPolicy` keeps the catalog entry's policy ID, boundaries,
  required boundaries, terminal observation window and redaction policy. Every boundary's status is
  `not-evaluated`: Capsule records observations, but does not decide whether a boundary was satisfied.
  Capsules started before the policy was recorded report `not-recorded`.
- **Activity windows.** A trace with no trace-context link to any activity is placed in a stimulus's time
  window (`association.kind: activity-window`) only when it started after that activity started, before
  the next activity started, and no more than 5 seconds after the activity completed. Other traces are
  `session-only`. A window is temporal placement, never a cause.
- **Span trees.** The HTML lists each trace's spans as a tree, each parent before its children and siblings
  by start time, with every span's offset from the trace start and its duration. Traces are ordered by start
  time. Selecting a span shows its start time, duration, parent (`None (root span)` for a root) and status
  (`UNSET` when the span recorded none), plus any exception events.
- **Readiness probes.** Blackbox's readiness probes send `User-Agent: blackbox-readiness/1` and back off from
  200 ms to one probe per second. The HTML collapses the traces they cause into one
  `readiness probe traces` row.
- **Infrastructure.** `resources.infrastructure` lists containers the capsule started besides its
  participants, such as Blackbox's telemetry collector, with the last state Docker reported for them.
- **System spans.** An activity's span count in the HTML includes only the system's spans. Blackbox's own
  activity span (service `blackbox-capsule`) is counted apart, so an untraced command shows
  `0 system spans`.

See [runtime evidence](runtime-evidence.md) for interpreting observations in a report.
Playwright reporting is still in development.
