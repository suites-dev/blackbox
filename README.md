<h1 align="center">BLACKBOX</h1>

<p align="center"><strong>Your agent writes the code. You own the behavior. BLACKBOX verifies the running system.</strong></p>

<p align="center">
  Engineers no longer need to know how their system is implemented.<br />
  They need to know how it behaves.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="Apache 2.0" /></a>
  <a href="docs/alpha-status.md"><img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Alpha" /></a>
</p>

<p align="center">
  <a href="#the-behavior-contract">The contract</a> ·
  <a href="#the-behavior-lane">The lane</a> ·
  <a href="#run-blackbox">Run it</a> ·
  <a href="docs/alpha-status.md">Alpha status</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

Coding agents can rewrite thousands of lines in minutes. A 20,000-line change may alter nothing observable; a
one-line change can break a business rule. Reading the diff cannot tell you which one you have. What you can know is
what the system must do, and that is what BLACKBOX checks: the running system, through its real inputs and outputs,
against a contract a person accepted.

## The behavior contract

A behavior contract states what the system must do at its boundaries: the responses it returns, the state it keeps,
and the effects it has on its dependencies. A person accepts it. It stays fixed while the implementation changes
underneath it, no matter who or what wrote the code.

**Example: one subscription, one payment.** A subscription service takes a payment, runs a fraud check and queues an
order. Two requests for the same user arrive at the same time. The contract:

| The system must                                                                                     | Checked against |
| --------------------------------------------------------------------------------------------------- | --------------- |
| Answer one request with `201` and the other with `409 duplicate-subscription`                       | Responses       |
| Keep exactly one subscription, one fraud audit and one payment intent                               | Stored state    |
| Call the fraud, payment and order services, write to the database and cache, and publish to a queue | Runtime effects |

Nothing in that contract names a class, a function or a framework. Rewrite the service and the contract does not
change. The response can be right while the payment state is wrong; that is the case this contract exists to catch.

<sub>Today this contract is the bundled test
[`subscription-system.spec.ts`](e2e/tests/playwright/subscription-system.spec.ts), which runs eight services in a fresh
Sandbox. It passes on a healthy system; the repository does not yet include a broken variant. Effect checks confirm that
calls happened; the exactly-once claim rests on the stored-state check.</sub>

## The behavior lane

Every change passes through one lane before it ships: **CODE → VERIFY → SHIP.** BLACKBOX is the VERIFY step. It does
not write code and does not replace your CI, deployment or observability tools.

<p align="center">
  <img width="800" src="docs/assets/readme/human-agent-verification-loop.svg" alt="The person approves the behavior contract and feeds it forward to the coding agent, which realizes or repairs the code. The real system runs in isolation with its dependencies and sends fresh runtime evidence to BLACKBOX, which returns findings: held, failed or not observed. Findings go back to the agent as repair work; proposed contract changes go back to the person, who decides." />
</p>

Each part has one owner:

- **The person owns the contract.** They accept what the system must do. A proposed change to the contract goes back
  to them.
- **The coding agent owns the code.** It writes and repairs the implementation, with any agent, editor or
  methodology.
- **BLACKBOX owns the verdict.** It runs the real system in isolation, captures evidence, and reports what held, what
  failed and what was not observed.

Findings go back to the agent as repair work. The agent does not decide what correct means, and it does not grade its
own work. A passing run supports only the checks that ran; missing evidence stays inconclusive, never a pass.

## Where we're going

**Every PR deserves a behavioral review.** A BLACKBOX check on a pull request should answer: what accepted behavior was
intentionally changed, what existing behavior was checked, which expectations were violated, what evidence supports
that, what could not be verified, and what needs investigation before merge.

It keeps two things apart: the **contract diff** (changes to accepted behavior) and the **execution diff** (changes
observed between runs or revisions). Neither is a summary of the source diff.

None of this exists in the alpha. Pull request reports, revision-aware comparison and impact planning are roadmap.
What exists is the execution and evidence layer they will rest on.

## What BLACKBOX needs from your system

Not how it is implemented. How to run it, how to act on it, and how to observe it.

<p align="center">
  <img width="800" src="docs/assets/readme/system-boundary.svg" alt="blackbox.config.yaml defines what to run (services and dependencies), how to act on it (actions and state inspection) and how to observe it (runtime observations). BLACKBOX then runs the real system." />
</p>

In the alpha, the system is driven through an HTTP entrypoint and observed through HTTP, PostgreSQL, Redis and SQS
effects. Node is the primary instrumented runtime.

**What BLACKBOX is not.** It is not a verifier for arbitrary source code. It does not replace unit tests, static
analysis, code review or specialized tools for isolated algorithms, and it does not prove a system correct. Its
conclusions are limited to the contract exercised, the evidence collected and the observation coverage available.

## Writing contracts today

Contracts live in your repository next to the code and rerun after every change. Today they are written in one of two
formats:

| Format                                                   | Status                      |
| -------------------------------------------------------- | --------------------------- |
| Playwright tests that use BLACKBOX fixtures              | Working                     |
| Feature files (Gherkin) that generate a Playwright suite | In source, not yet verified |

Existing tests, acceptance criteria and API contracts are good sources for a contract. The alpha does not execute
arbitrary requirement documents.

## Run BLACKBOX

BLACKBOX is `0.0.1-alpha` and **not on npm yet**. You need Node 22.15+, pnpm 9.15.4 and Docker.

**Check your setup (no Docker).** This validates the bundled catalog. It is a configuration check, not a
verification run.

```sh
git clone https://github.com/suites-dev/blackbox.git
cd blackbox
pnpm install --frozen-lockfile
pnpm build
cd e2e && pnpm exec blackbox catalog validate && pnpm exec blackbox systems
```

**Run the example contract.** The subscription test installs BLACKBOX from a disposable local package registry, as CI
does, so you start a registry, publish the built packages to it, and run the suite. The exact commands are in
[Alpha status](docs/alpha-status.md#run-the-bundled-example-from-source). The run writes a JUnit file and per-test
evidence attachments to `e2e/test-results/`. A one-command version does not exist yet.

**Use it on your own application: not available yet.** Connecting BLACKBOX to another repository goes through the
`blackbox` CLI and its agent skills, which need the npm release. Until then, BLACKBOX runs from a source checkout only.

## With your coding agent

Nothing about how you write code changes. Keep your agent, your editor and your process.

1. **Connect.** The agent discovers services and dependencies and prepares configuration.
2. **Accept the contract.** You review and accept the behavior to verify.
3. **Verify.** BLACKBOX runs the system and checks it against the contract.
4. **Inspect.** You and the agent read results and evidence, including what was not observed. The agent can reproduce
   a failure in a Capsule with `blackbox up`, `run`, `show` and `report`.
5. **Preserve.** The contract stays in the repository and reruns after every change.

## Open source

BLACKBOX is Apache-2.0. The code that evaluates behavioral claims is open and runs in your own infrastructure, so you
can read how a result was reached and keep your code and runs under your control. Issues and pull requests are
welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Alpha status

Interfaces will change. [Alpha status](docs/alpha-status.md) lists the audited revision, what works, what is in source
but unverified, and what is in development. BLACKBOX is not a hardened sandbox for hostile code; see
[SECURITY.md](SECURITY.md).

[Packages](packages/blackbox/README.md) · [Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md) · [License](LICENSE)
