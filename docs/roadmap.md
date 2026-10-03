# Blackbox roadmap

The current alpha provides Capsule execution, Node instrumentation, raw observations, and retained reports.
The next steps make those capabilities easier to use and bring the same foundation to native Playwright tests.
Assurance follows as a distinct layer. Check [alpha availability](alpha-status.md) for what works today.

These seven issues own the scope, decisions, definitions of done, and progress. Their order below groups the work;
it does not promise release dates.

| Work                                                                                   | Intended result                                                                                                                   |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Native Playwright integration #27](https://github.com/suites-dev/blackbox/issues/27)  | Run native tests with a fresh sandbox and retained evidence per physical attempt, including retries.                              |
| [Project skill installer #28](https://github.com/suites-dev/blackbox/issues/28)        | Install version-aligned discovery guidance for Codex, Claude Code, and Cursor with predictable updates.                           |
| [Playwright assurance research #26](https://github.com/suites-dev/blackbox/issues/26)  | Specify claims, admissible evidence, qualification, and supported/refuted/insufficient findings before implementing an evaluator. |
| [CLI vocabulary and experience #24](https://github.com/suites-dev/blackbox/issues/24)  | Align commands with the lab, experiment, trial, activity, evidence, and claim concepts through concrete user journeys.            |
| [Public packages and names #25](https://github.com/suites-dev/blackbox/issues/25)      | Choose the public installation/export surface and make its complete dependency closure installable.                               |
| [Lerna and publishing workflows #29](https://github.com/suites-dev/blackbox/issues/29) | Prepare versioning and trusted publication from an exact reviewed release commit.                                                 |
| [Capsule HTML report #30](https://github.com/suites-dev/blackbox/issues/30)            | Combine an experiment narrative with an investigation workspace for commands, traces, state-check output, and evidence gaps.      |

CLI design, package design, and assurance research can start independently. The skill installer follows the CLI
command decision. Playwright's public imports follow the package decision, while its infrastructure can advance
before publishing. Publishing workflows depend on the approved package set. Report terminology follows CLI design;
visual design will incorporate the additional user references recorded in its issue.

Native Playwright exposes explicit propagated activities, an effects fixture, normalized projection, and a three-valued
contract evaluator. The initial public selection includes completed stimuli and excludes setup and inspection. Missing
capture remains inconclusive, including under negation; observed effects do not prove durable state or completeness.
Accepted baselines and broader assurance remain future work. ODC/decision coverage, generated Gherkin/specs, suite
generation, and legacy contract-promotion surfaces are outside this roadmap. Final package names and command renames
are decisions owned by their issues.

For current agent setup, see [agent skills](agent-skills.md). For the present product model, see
[the verification machine](verification-machine.md).
