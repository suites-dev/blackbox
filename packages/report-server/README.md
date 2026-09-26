# Report server

`@suites/blackbox-report-server-internal` is the private, unpublished workspace
package that serves Blackbox's read-only local report registry and viewer.

It is transport and presentation infrastructure, not a report implementation. The
server knows how to aggregate providers, route exact IDs, poll for updates, and own
a loopback listener. Each provider remains responsible for reading its data,
validating its schema, redacting sensitive values, allowlisting artifacts, and
rendering its report.

## How it fits together

```text
`blackbox capsule report serve`
              │
              ▼
CLI composition ── creates Capsule provider and project scope
              │
              ▼
report-server ── registry, routes, polling, listener ownership
              │
              ▼
Capsule provider ── reads retained state, validates/redacts, renders
```

The [CLI report command](../cli/src/commands/capsule/report/serve.ts) creates the
[Capsule provider](../cli/src/reporting/capsule-provider.ts) and passes it to this
package through [CLI composition](../cli/src/reporting/serve.ts). Capsule itself
does not depend on the CLI or report server. This keeps report storage and Capsule
schema semantics out of the generic HTTP layer.

## Architecture and ownership

| Layer                                            | Owns                                                                                         | Does not own                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [`ReportProvider`](src/model/provider.ts)        | Listing, exact lookup, validation, redaction, artifact allowlists, report-specific rendering | HTTP, polling, listener reuse                        |
| [HTTP server](src/http/server.ts)                | Loopback binding, request boundaries, response headers, shutdown                             | Filesystem discovery or report interpretation        |
| [Router and registry](src/http/routes.ts)        | Exact route matching, provider dispatch, partial provider failures                           | Provider document schemas                            |
| [Generic browser shell](src/ui/registry-page.ts) | Search, filtering, navigation, polling, stale-state UI                                       | Capsule DOM and report semantics                     |
| [Lifecycle helper](src/lifecycle/ensure.ts)      | Start-or-reuse identity checks and ownership capability                                      | Choosing a fallback port or stopping another process |

The package never imports Capsule and never accepts arbitrary filesystem paths.
Adding a report family means implementing `ReportProvider` in the composition
layer, then injecting it. Provider `type` values must be unique safe URL segments.

The shared JSON Schemas cover only transport envelopes:

- [`report-registry-v1.json`](src/schema/report-registry-v1.json) describes summaries
  and per-provider listing failures.
- [`report-response-v1.json`](src/schema/report-response-v1.json) describes document,
  artifact, and failure envelopes. Its `document` values are intentionally opaque.
- [`report-server-identity-v1.json`](src/schema/report-server-identity-v1.json)
  describes the scoped identity used for listener reuse.

The owning provider must validate and sanitize the opaque payload before returning
it. The current Capsule provider exposes only its redacted report projection and
allowlists `report.json`; the generic server neither weakens nor supplements those
rules. Provider exceptions are converted to a generic error so underlying messages
do not cross the HTTP boundary.

## Routes

All routes accept only `GET` and `HEAD`.

| Route                                        | Result                                                        |
| -------------------------------------------- | ------------------------------------------------------------- |
| `/`                                          | Generic registry and report browser shell                     |
| `/api/server`                                | Versioned identity for a scoped viewer                        |
| `/api/reports`                               | Summaries from all providers, plus explicit provider failures |
| `/api/reports/:type`                         | Summaries from one provider                                   |
| `/api/reports/:type/:id`                     | Exact provider-owned report document envelope                 |
| `/api/reports/:type/:id/artifacts/:artifact` | Exact allowlisted artifact envelope                           |
| `/reports/:type/:id`                         | Provider-rendered report HTML                                 |

Registry listing is lazy: it does not load report documents or artifacts. Missing
records, unavailable artifacts, invalid requests, and provider errors remain
distinct outcomes. A failed provider does not hide readable providers.

## Live viewer and exported snapshots

The browser polls the registry and selected document every second. Each request has
a five-second timeout. It rerenders only when serialized document content changes;
if an update fails, it keeps the last successful snapshot visible, labels it stale,
and retries. “Connected” describes the viewer request, not whether a Capsule is
still running.

The live viewer can therefore follow a running session or display retained stopped
sessions. Closing the viewer does not stop Capsules.

`blackbox capsule report export` is different: the
[export path](../cli/src/reporting/export.ts) reads one exact Capsule report and
writes a point-in-time HTML or JSON artifact. It does not start this HTTP server,
poll, or update after export. Live HTML and HTML export share Capsule's renderer,
but have different lifecycle ownership.

## Listener lifecycle and security boundary

Use `ensureReportServer` for CLI-style composition:

```ts
const result = await ensureReportServer({
  kind: 'ensure-report-server',
  providers: [capsuleProvider],
  port: DEFAULT_REPORT_PORT, // 4310
  scopeId: projectRootDigest,
  selection: { kind: 'registry' },
});
```

Binding `127.0.0.1` is the ownership lock. When the requested port is occupied,
the helper checks `/api/server` for the exact opaque scope and sorted provider set.
A match returns a URL without `close()`; only the caller that acquired the listener
receives the shutdown capability. A mismatch or unresponsive listener fails without
opening a fallback port or terminating the existing process. `startReportServer`
and port `0` remain available for isolated callers and tests.

The server also requires the exact loopback `Host`, permits only its own `Origin`,
rejects unsafe path segments before provider dispatch, disables caching, and emits
restrictive CSP, referrer, and MIME-sniffing headers. These controls protect a local
viewer; they do not make unredacted provider data safe to serve.

## Public workspace surface

[`src/index.ts`](src/index.ts) exports `ensureReportServer`, `startReportServer`,
`DEFAULT_REPORT_PORT`, `renderRegistryPage`, provider/server types, and the three
tracked envelope schemas. Build copies the schemas into `dist/schema/`.

From the repository root, maintainers can run:

```bash
pnpm --filter @suites/blackbox-report-server-internal lint
pnpm --filter @suites/blackbox-report-server-internal build
pnpm --filter @suites/blackbox-report-server-internal test
```

HTTP tests bind loopback sockets, so the test command needs permission to create a
local listener. Update this README when routes, provider ownership, identity matching,
polling behavior, exported schemas, or CLI composition changes.
