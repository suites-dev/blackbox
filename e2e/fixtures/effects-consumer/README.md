# Standalone effects consumer

This is a synthetic packaging-boundary fixture. Its three OTLP spans resemble structured PostgreSQL and RabbitMQ producer attributes; they are not retained live telemetry.

After building `@suites/blackbox-effects`, run `pnpm test:effects:consumer` from the repository root. The harness packs the candidate, installs the tarball offline into a temporary project outside the workspace, and runs these plain Node tests. It invokes the repository's TypeScript compiler explicitly against the consumer's own configuration; the consumer installs only the effects package. There are no workspace links, source aliases, Playwright dependencies, registry publication, or Docker services.

The assertions cover public runtime exports, immutable graphs/contracts/results, structured operation witnesses, conservative unknowns, malformed input, and declarations. Disposable package controls omit the runtime entrypoint or force the evaluator to return `pass`. The first must fail package loading, while the second must fail semantic assertions. The unmodified package runs successfully again after both controls.

Evidence is retained under `.blackbox/tmp/effects-consumer.*`; installed temporary projects and caches are removed on success and failure. This establishes candidate tarball acceptance, not acceptance of a released registry version or live producer instrumentation.
