# Capsule

Capsule owns the retained experiment record and its report projection. Session,
activity, progress, cleanup, and failure records are written under the selected
project's `.blackbox/experiments/capsule-<session-id>/` directory.

`reportCapsule()` reads those retained records, validates their identities, and
returns a redacted `CapsuleReportDocument`. JSON and HTML reports are generated
projections of that document. They do not replace the retained evidence and do
not mutate it. `renderCapsuleHtml()` is exported here because Capsule owns the
meaning of the document; the CLI only composes it into commands and providers.

The report server receives a provider from the composition root. Capsule does
not depend on the report server or on the CLI.

Startup progress is retained as the versioned `capsule-progress` document in
`progress.json`. Its JSON Schema is exported as `capsuleProgressSchema` and at
`@suites/blackbox-capsule-internal/schema/capsule-progress-v1.json`. Readers still
accept validated legacy event arrays. Both terminal progress and the live report
consume the same observations, including in `--silent` mode where only terminal
presentation is suppressed. Container running/health observations remain separate
from the configured application readiness check. A progress persistence failure
fails startup and cleans an already-acquired sandbox.
