# Operating contract

## Terms and authority

A **catalog entry** selects a `system` or `subsystem`. **Participants** are the
application processes and dependencies selected for that environment. An
**acquisition** adapter starts its resources. **Activation** loads application-owned
instrumentation. A **driver** prepares a command for a target and execution
location. An **observation boundary** states what is intended to be observed.

A **Capsule** owns one acquired environment and retained execution scope.
Activities record setup, stimuli and inspections. A procedure's initial conditions,
stimulus and terminal predicates are separate from the apparatus. Readiness is
neither a behavioral entrypoint nor a terminal witness by default.

Root `blackbox.config.yaml` is authoritative application configuration. Compose
keeps ordinary deployment configuration. The audit is descriptive and evidential,
not a second catalog. Never add audit-only classifications to catalog YAML.

## Three topology views and supporting layers

Maintain deployment, lifecycle-control and behavioral views over stable node IDs.
Retain source/package edges as supporting evidence, not runtime service links.

For example, `src/billing.ts imports redis` is a source dependency. A build command
mapping it into a worker establishes code-to-participant evidence. A `REDIS_URL`
reference, queue operation and local Compose service support a candidate
worker-to-Redis relationship. A retained runtime observation adds occurrence
evidence for the exercised conditions, not coverage of every path.

Assign ownership and lifecycle independently. A third-party database engine can
run in a Capsule-owned container. A project-owned service can be preexisting and
outside Capsule control. The testing literature's "managed dependency" can refer
to exclusively owned application state, while deployment tooling may mean a cloud
managed service. Use the explicit fields, not the ambiguous adjective alone.

Substitution is a separate, approved decision with preserved behavior and limits.
Mocking away the behavior under investigation changes the question. Credentials
are not proof of unmanaged lifecycle, and absence of a credential is not proof of
local isolation.

## Evidence and handoffs

Source evidence identifies repository, revision, path, locator and assertion.
Inference names supporting evidence and its reasoning. Runtime evidence names a
retained receipt. Unresolved evidence records what is missing. Preserve conflicting
facts instead of overwriting one with an unsupported conclusion.

Inspectors return `inspected`, `blocked` or `failed` fragments. The router composes
an audit, resolves identities, selects a boundary, and sends only approved edits
to catalog authoring. Commands remain argument arrays; do not interpolate
untrusted values into a shell.

## Invariants

No source reading implies execution permission. No deployment graph implies the
right behavioral boundary. No valid catalog implies acquisition. No successful
startup implies behavior. No acknowledgement implies completion. No empty
observation set implies absence. No schema-valid audit authenticates evidence.
Cleanup is part of validation, not an optional success-only step.
