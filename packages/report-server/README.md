# Local report server

Internal workspace package for a read-only report registry and local report viewer.
The CLI composes providers; this package does not import Capsule or read arbitrary
filesystem paths. Providers retain responsibility for artifact schemas, validation,
redaction, fixed artifact-name allowlists, and report-specific HTML renderers.
The server owns only the generic registry shell and HTTP transport.

```ts
const server = await startReportServer({
  kind: 'start-report-server',
  providers: [capsuleProvider],
  port: 0,
  selection: { kind: 'registry' },
});
// Print server.url. The CLI owns signal handling and calls server.close().
```

The listener binds only to `127.0.0.1`. Port `0` requests an available port. The
registry lists summaries without loading report documents or artifacts. Selecting
an exact report loads the provider's renderer in the registry viewer. The browser
polls summaries and selected HTML every second, with a five-second request timeout.
It replaces the displayed HTML only when the snapshot changes, labels failed
updates as stale/unavailable, and retries without discarding the last snapshot.
Connection status refers to the viewer's requests, not the execution's liveness. Static HTML
export can call the same renderer directly. A provider may generate a projection on
demand; the server does not persist or reinterpret it.

| Route | Result |
| --- | --- |
| `/` | Registry browser shell |
| `/api/reports` | Registry across injected providers |
| `/api/reports/:type` | Registry for one provider |
| `/api/reports/:type/:id` | Exact report document envelope |
| `/api/reports/:type/:id/artifacts/:artifact` | Exact allowlisted artifact envelope |
| `/reports/:type/:id` | Provider-rendered report HTML |

Only GET and HEAD are supported. Registry failures remain visible alongside
readable providers. Missing records, unavailable artifacts, and provider failures
have distinct results. Server errors do not expose underlying exception text.

`reportRegistrySchema` and `reportResponseSchema` are ESM exports of the tracked
JSON Schemas in `src/schema/`; build copies the schemas into `dist/schema/`.
Their `document` payloads are validated against the owning provider's schemas.
The server's schemas specify only the shared envelopes.

Run `pnpm --filter @suites/blackbox-report-server-internal build`, `lint`, and
`test`. HTTP integration tests require permission to bind loopback sockets.
