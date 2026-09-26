# Alpha availability and limitations

Blackbox is an open-source project in active development. It has not been published to npm yet.
The default branch is `release/v0.0.1-alpha`; [clone and build it](getting-started.md) to try it locally.

The [verification model](verification-machine.md) describes the product concepts. The workflows below identify which
parts are available in this alpha.

## Supported workflows

- Start a configured application or subsystem with Docker Compose.
- Run host commands or use configured drivers, recording each activity and its result.
- Install Node instrumentation and inspect raw runtime observations by session, activity, or trace.
- Open a local Capsule report or export JSON and HTML snapshots.
- Stop the application and keep its experiment records for later inspection.

The repository includes a subscription application and an optional guided demo so you can explore these capabilities.
See the [CLI reference](cli.md) for command options.

## Preview limitations

| Capability                                                                              | Current status                                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Playwright integration                                                                  | In progress. Use Capsule for now.                                 |
| Effect matchers and snapshots                                                           | Not available yet. Raw observation queries are available.         |
| Capsule checkpoints                                                                     | Not available yet.                                                |
| Automatic project setup and skill installation                                          | Not available yet; the CLI reports a not-implemented error.       |
| General test reports, history, and baseline updates                                     | Not available yet. Capsule reports work through `capsule report`. |
| Python and Java instrumentation installers                                              | Not supported yet. The current installer supports Node.           |
| Decision coverage, generated feature files, and automated verification/repair workflows | Future work.                                                      |

Commands, configuration, and report formats may change as the first alpha takes shape.

## Use Blackbox with a coding agent

The repository includes a portable [discovery skill](../agent-skills/README.md). Copy its complete directory,
including references, to a skill location supported by your agent. CLI-based skill installation is not available yet.
Some skill references discuss capabilities still in development; use the status above to choose a working path.

Try asking your agent:

> Help me run the included application in a Capsule, send a subscription request, and explain the command result
> and runtime observations. Stop the Capsule when we're finished.
