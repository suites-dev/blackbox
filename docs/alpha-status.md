# Alpha availability and limitations

Blackbox is an open-source project in active development. It has not been published to npm yet.
The default branch is `release/v0.0.1-alpha`; [clone and build it](getting-started.md) to try it locally.

The [verification model](verification-machine.md) describes the product concepts. The workflows below identify which
parts are available in this alpha.

## Supported workflows

- Start a configured application or subsystem with Docker Compose.
- Run host commands or use configured drivers, recording each activity and its result.
- Install Node instrumentation and inspect raw runtime observations by session, activity, or trace.
- Install the project-local Discovery skill for Codex, Claude Code, or Cursor.
- Open a local Capsule report or export JSON and HTML snapshots.
- Stop the application and keep its experiment records for later inspection.

The repository includes a subscription application and an optional guided demo so you can explore these capabilities.
See the [CLI reference](cli.md) for command options.

## Preview limitations

| Capability                                          | Current status                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Playwright integration                              | Preview: per-attempt Sandbox, telemetry, and effects fixtures.    |
| Effect projection and snapshots                     | Not available yet. Raw observation queries are available.         |
| Capsule checkpoints                                 | Not available yet.                                                |
| Automatic project setup                             | Not available yet; `setup init` remains reserved.                 |
| General test reports, history, and baseline updates | Not available yet. Capsule reports work through `capsule report`. |
| Python and Java instrumentation installers          | Not supported yet. The current installer supports Node.           |

Native Playwright execution now composes the shared Sandbox for each physical test attempt, including retries. The
effects fixture and `toSatisfy` contract boundary are present, but they fail as inconclusive until a runtime supplies
normalized effects. A separate assurance stage will add effect projection, claim qualification, and accepted-baseline
comparisons. See the [roadmap](roadmap.md).

ODC/decision coverage, generated Gherkin or feature files, suite generation, and legacy contract-promotion workflows
are outside the current product direction. Automated repair is not a committed product capability; developers and
agents can already use execution feedback in their own repair loops.

Commands, configuration, and report formats may change as the first alpha takes shape.

## Use Blackbox with a coding agent

The repository includes a portable discovery skill. Follow [agent skill setup](agent-skills.md) for
Codex, Claude Code, or Cursor. The Skills plugin can install the complete directory and its references
with `blackbox skill install discovery`.
Some skill references discuss capabilities still in development; use the status above to choose a working path.

Try asking your agent:

> Help me run the included application in a Capsule, send a subscription request, and explain the command result
> and runtime observations. Stop the Capsule when we're finished.
