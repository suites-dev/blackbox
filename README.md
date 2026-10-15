<h1 align="center">BLACKBOX</h1>

<p align="center"><strong>Code changes. Behavior is the contract.</strong></p>

<p align="center">
  Independent system verification for I/O-driven software.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="Apache 2.0" /></a>
  <a href="docs/alpha-status.md"><img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Alpha" /></a>
</p>

<p align="center">
  <a href="#see-it-work">See it work</a> ·
  <a href="#run-blackbox">Run it</a> ·
  <a href="packages/blackbox/README.md">Packages</a> ·
  <a href="docs/alpha-status.md">Alpha status</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

Your agent writes the code. BLACKBOX verifies the running system.

BLACKBOX exercises real applications through their I/O boundaries, runs them with their dependencies in isolated
Sandboxes, and checks their responses, state changes and runtime effects against accepted expectations. It keeps
the execution evidence so developers and coding agents can see what was verified, what failed, and what remains
unknown. It does not matter which agent wrote the code or which methodology produced it.

## Why BLACKBOX

Coding agents can rewrite thousands of lines in minutes. A 20,000-line change may alter nothing observable; a
one-line change can break a business rule. Reading the diff cannot settle which one you have, and reviewers cannot
keep up with the volume.

Unit tests, integration tests and Playwright remain essential. BLACKBOX adds a different control point: the running
system, started fresh for every test, checked against expectations that stay fixed while implementations change, with
the evidence of what actually happened kept per execution. When the same agent writes the code and decides what
success means, a passing suite says less than it appears to. BLACKBOX keeps the accepted expectations separate and
reports what was not observed instead of treating it as a pass.

## What BLACKBOX verifies

BLACKBOX verifies systems that can be exercised through defined input and output interfaces: APIs, network services,
message-driven systems, and applications with externally exercisable operations. In the alpha, tests drive the system
through an HTTP entrypoint and observe HTTP, PostgreSQL, Redis and SQS effects.

Verification can look past the immediate output: persisted state, calls to dependencies, published messages and other
observable effects can all matter to an accepted requirement. The target is **system behavior at its I/O boundaries**,
not how the implementation was written.

**What BLACKBOX is not.** It is not a general-purpose verifier for arbitrary source code. It does not replace unit
tests, static analysis, code review or specialized tools for isolated algorithms, and it does not prove a system
correct. Its conclusions are limited to the expectations exercised, the evidence collected and the observation
coverage available.

**Different implementation. Same accepted contract. Independently verified execution.**

## See it work

**The API returned success. Did the system do the right thing?**

A subscription service takes a payment, runs a fraud check and queues an order. Two requests for the same user arrive
at the same time. The accepted behavior: **one subscription, one payment.** The service answers one request with `201`
and the other with `409`.

The bundled test
[`subscription-system.spec.ts`](e2e/tests/playwright/subscription-system.spec.ts) starts eight services in a fresh
Sandbox (the application services, PostgreSQL, Redis, LocalStack for SQS, and a mock payment provider), sends both
requests, and checks three kinds of evidence:

| Check                                                                                                        | Source                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| One `201` and one `409` with `duplicate-subscription`                                                        | The HTTP responses                          |
| Exactly one subscription, one fraud audit and one payment intent                                             | The system's stored state                   |
| Calls to the fraud, payment and order services, a database write, a cache write and a queue message occurred | Runtime effects observed with OpenTelemetry |

The response can be right while the payment state is wrong. That is the case this test is built to expose.

**Today this test passes on a healthy system, and that is all it shows.** The repository does not yet include a broken
variant, so there is no recorded failing run to show. Effect checks here confirm that calls happened; the
exactly-once claim rests on the stored-state check.

## How it works

```text
CODE  ─────────►  VERIFY  ─────────►  SHIP
agents and        BLACKBOX             your existing delivery
people write      runs the system,     and production tooling
code              checks accepted
                  behavior, returns
                  evidence
      ◄── violations and missing evidence go back to the agent ──
```

BLACKBOX does not write code and does not replace your CI, deployment or observability tools. Inside VERIFY:

```text
Accepted expectations  →  Isolated execution  →  Runtime evidence  →  Result
tests that enter          fresh Sandbox:          responses, stored      what held, what failed,
through the system's      real app + deps         state, effects,        what was not observed
interfaces                                        OpenTelemetry
```

Accepted behavior, observed behavior and verification evidence stay separate. An observed effect is not automatically
desired, a passing run supports only the assertions that ran, and a result never claims to prove the whole system
correct. Agents may change implementations; they must not silently redefine what correct means.

Expectations today are [Playwright](https://playwright.dev) tests that use BLACKBOX fixtures. Existing tests,
acceptance criteria and API contracts are useful sources for them. The alpha does not execute arbitrary requirement
documents.

## Run BLACKBOX

BLACKBOX is `0.0.1-alpha` and **not on npm yet**. You need Node 22.15+, pnpm 9.15.4 and Docker.

**Check your setup (about two minutes, no Docker).** This validates the bundled catalog. It is a configuration
check, not a verification run.

```sh
git clone https://github.com/suites-dev/blackbox.git
cd blackbox
pnpm install --frozen-lockfile
pnpm build
cd e2e && pnpm exec blackbox catalog validate && pnpm exec blackbox systems
```

**Run the real verification (about six minutes plus image pulls).** The subscription test installs BLACKBOX from a
disposable local package registry, as CI does, so you start a registry, publish the built packages to it, and run
the suite. The exact commands are in
[Alpha status](docs/alpha-status.md#run-the-bundled-example-from-source). The run writes a JUnit file and per-test evidence
attachments to `e2e/test-results/`. A one-command version does not exist yet.

**Use it on your own application.** Install the skills, then ask your coding agent to connect BLACKBOX to the
repository:

```sh
pnpm exec blackbox skills install blackbox --codex     # or --claude
```

The skills guide the agent through discovering services and dependencies and writing the configuration, and the
CLI gives it commands and structured results. Setup against an external repository has not been validated end to
end in the alpha. See the [`@suites/blackbox` package](packages/blackbox/README.md) and the [skills installer](packages/skills/README.md).

## With your coding agent

Nothing about how you write code changes. Keep your agent, your editor and your process.

1. **Connect.** The agent discovers services and dependencies and prepares configuration.
2. **Specify.** You review the expectations to verify.
3. **Verify.** BLACKBOX runs the system and checks them.
4. **Inspect.** You and the agent read results and evidence, including what was not checked. The agent can reproduce
   a failure in a Capsule with `blackbox up`, `run`, `show` and `report`.
5. **Preserve.** The accepted expectations stay in the repository and rerun after every change.

## Where we're going

**Every PR deserves a behavioral review.** A BLACKBOX check on a pull request should answer: what accepted behavior
was intentionally changed, what existing behavior was checked, which expectations were violated, what evidence
supports that, what could not be verified, and what needs investigation before merge.

It keeps two things apart: the **contract diff** (changes to accepted expectations) and the **execution diff**
(changes observed between runs or revisions). Neither is a summary of the source diff.

None of this exists in the alpha. Pull request reports, revision-aware comparison and impact planning are
roadmap. What exists is the execution and evidence layer they will rest on.

## Open source

BLACKBOX is Apache-2.0. The code that evaluates behavioral claims is open and runs in your own infrastructure, so
you can read how a result was reached and keep your code and runs under your control. Issues and pull requests are
welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Alpha status

Interfaces will change. [Alpha status](docs/alpha-status.md) lists the audited revision, what works, what is in
source but unverified, and what is in development. Observations depend on instrumentation coverage and Node is the
primary instrumented runtime. BLACKBOX is not a hardened sandbox for hostile code; see [SECURITY.md](SECURITY.md).

[Packages](packages/blackbox/README.md) · [Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md) · [License](LICENSE)
