# Local report server

Internal workspace package for a read-only report registry and local report viewer.
The CLI composes providers; this package does not import Capsule or read arbitrary
filesystem paths. Providers retain responsibility for artifact schemas, validation,
redaction, fixed artifact-name allowlists, and report-specific HTML renderers.
The server owns only the generic registry shell and HTTP transport.

```ts
const result = await ensureReportServer({
  kind: 'ensure-report-server',
  providers: [capsuleProvider],
  port: DEFAULT_REPORT_PORT, // 4310
  scopeId: projectRootDigest,
  selection: { kind: 'registry' },
});
// A started result owns result.server and its close() capability.
// A reused result contains a URL, without a close() capability.
```

The listener binds only to `127.0.0.1`. Binding the requested port establishes
ownership atomically. If it is occupied, `ensureReportServer` checks the existing
viewer's versioned identity, opaque scope ID, and provider types. A match reuses
the listener; a mismatch or an unresponsive listener produces a conflict. It does
not choose a fallback port or stop the other process. Only the original owner
closes the viewer. The CLI derives scope from the canonical project directory and
defaults to port `4310`; selecting another session changes the URL, not the server.
The lower-level `startReportServer` and explicit port `0` remain available for
isolated listeners in tests or callers deliberately requesting a fresh port.

The
registry lists summaries without loading report documents or artifacts. Selecting
an exact report opens a separate report view using the provider's injected client
renderer. The browser polls summaries and selected JSON every second, with a
five-second request timeout. It renders only when the snapshot changes, labels failed
updates as stale/unavailable, and retries without discarding the last snapshot.
Connection status refers to the viewer's requests, not the execution's liveness. Static HTML
export can call the same renderer directly. A provider may generate a projection on
demand; the server does not persist or reinterpret it.

| Route                                        | Result                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `/`                                          | Registry browser shell                                             |
| `/api/server`                                | Versioned identity for a scoped viewer; no project filesystem path |
| `/api/reports`                               | Registry across injected providers                                 |
| `/api/reports/:type`                         | Registry for one provider                                          |
| `/api/reports/:type/:id`                     | Exact report document envelope                                     |
| `/api/reports/:type/:id/artifacts/:artifact` | Exact allowlisted artifact envelope                                |
| `/reports/:type/:id`                         | Provider-rendered report HTML                                      |

Only GET and HEAD are supported. Registry failures remain visible alongside
readable providers. Missing records, unavailable artifacts, and provider failures
have distinct results. Server errors do not expose underlying exception text.

`reportRegistrySchema`, `reportResponseSchema`, and `reportServerIdentitySchema` are ESM exports of the tracked
JSON Schemas in `src/schema/`; build copies the schemas into `dist/schema/`.
Their `document` payloads are validated against the owning provider's schemas.
The server's schemas specify only the shared envelopes.

Run `pnpm --filter @suites/blackbox-report-server-internal build`, `lint`, and
`test`. HTTP integration tests require permission to bind loopback sockets.
