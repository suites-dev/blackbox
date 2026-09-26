# Security policy

Blackbox starts local HTTP servers, executes test processes, controls containers,
and captures telemetry. Treat those capabilities as security boundaries. Passing
scanners does not prove that a release has no vulnerabilities.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/suites-dev/blackbox/security/advisories/new).
Do not put exploit details, credentials, or sensitive traces in public issues or PRs.
Include the affected commit/version, platform, reproduction using synthetic data,
impact, and any mitigation. Test only systems you own or have permission to test.

Maintainers aim to acknowledge reports within three business days and provide a
triage update within seven. These are targets, not a guaranteed response time.
We coordinate disclosure, a fix, release notes, and a GitHub Security Advisory with
the reporter. Request a CVE when appropriate; hiding a vulnerability to avoid a CVE
is not an acceptable response.

## Supported versions

The project is pre-release. Security fixes target the current alpha release branch
(`release/v0.0.1-alpha`) and are forwarded to `main`. Older snapshots and forks have
no backport guarantee. Before the first stable release, publish an explicit support
matrix here. Review this policy whenever a release line is opened or retired.

## Required engineering controls

- Bind host-facing listeners to explicit loopback addresses by default. An explicit
  container-internal wildcard bind requires an isolated network and loopback-only
  host port publication. Never silently expose a service on the LAN or internet.
- Treat local HTTP services as reachable by hostile websites and other local users.
  Validate Host and Origin, reject unexpected methods, and require authorization
  for sensitive operations. CORS is not authentication. Test DNS rebinding and CSRF.
- Validate network destinations and redirects before connection. Consider IPv4,
  IPv6, private/link-local addresses, DNS resolution changes, and SSRF. Never disable
  TLS certificate verification.
- Pass commands as argument arrays with `shell: false`; keep untrusted values out of
  shell scripts. Validate paths, symlinks, archive entries, and working directories
  before reading, writing, extracting, or deleting outside an owned workspace.
- Bound request sizes, timeouts, queues, output, and telemetry retention. Prove that
  cancellation and shutdown close sockets, processes, and containers.
- Treat test code, drivers, manifests, and Docker access as privileged inputs.
  Blackbox is not a hardened sandbox for hostile code. Avoid privileged containers,
  host networking, and unnecessary host mounts or Docker socket exposure.
- Redact credentials before storing or displaying traces, errors, reports, or CI
  artifacts. Use synthetic secrets in tests. Never upload a real user trace publicly.
- Add negative tests whenever a trust boundary changes: unauthorized access,
  cross-origin requests, traversal, injection, oversized input, or leaked resources.

These are contribution requirements, not a claim that every existing code path has
already been independently audited. See [security operations](maintainers/docs/security.md) for
the enforced gates and [CONTRIBUTING.md](CONTRIBUTING.md) for review requirements.

## Triage and releases

Known dependency advisories of any severity block the dependency audit. CodeQL
security findings at medium or higher and correctness errors block merging;
custom Semgrep findings and detected secrets also block. Scanner errors must fail
closed. No blanket ignore files, automatic dismissals, or permanent bypasses.

Fix confirmed findings before release. For a false positive, record evidence,
affected versions, an owner, a review date, and approval by another maintainer;
make the narrow suppression through a reviewed PR or the audited GitHub alert UI.
An actively exploited issue requires immediate triage, credential rotation where
needed, and coordinated remediation. CVSS alone does not determine urgency.
