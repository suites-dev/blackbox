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

Exports are snapshots. An HTML export made while running stays a running snapshot after stop. Export again to
capture the stopped state, choosing a different output path if you want to retain both versions. Serving and exporting
read retained evidence without changing the experiment.

See [runtime evidence](runtime-evidence.md) for interpreting observations in a report.
Playwright reporting is still in development.
