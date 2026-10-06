# Working with coding agents

Blackbox is built for people who develop software with coding agents. The human supplies intent and approves expected behavior. The agent operates the framework through its CLI and installed skills.

This is not a separate testing philosophy to learn before setup. Start with one question about a running system, and require the agent to return the execution and evidence that answer it.

## Choose a task

| Task | Guide |
| --- | --- |
| Install the operating instructions | [Skills](skills.md) |
| Investigate an unexplained result | [Investigation workflow](investigation-workflow.md) |
| Turn accepted behavior into durable checks | [Authoring verification](authoring-verification.md) |
| Configure a new repository | [Agent onboarding](../getting-started/agent-onboarding.md) |
| Use a Spec Kit specification | [Spec Kit integration](../integrations/spec-kit.md) |

## Ownership

The agent may inspect files, propose a boundary, prepare a catalog, and select relevant tests within the authorized task. Running project code, pulling images, opening listeners, using credentials, or contacting external systems requires the corresponding permission. A skill tells the agent how to work; it does not grant permission.

Expected behavior stays separate from observed behavior. An agent may propose a specification change, but it must not quietly change expectations to turn a failed run green.

## A useful return from the agent

Ask for the selected system, source revision, exact execution identity, checks performed, evidence locations, limitations, and cleanup result. A human summary is useful, but it must link back to the actual records rather than replace them.

The agent should distinguish a passed assertion, a runtime observation, and its own interpretation. “The agent says it worked” is not an additional source of runtime evidence.

## Keep the context small

Load the entry skill first and the relevant specialist when needed. There is no reason to load the entire schema or every operating guide into every coding conversation. Use command help and structured results for the current installation rather than remembering an old command profile.

## Source contract

[Entry skill](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/blackbox/skills/blackbox/SKILL.md). [Capsule procedure](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/SKILL.md).

## Pages in this section

- [Agent skills](skills.md)
- [Investigation workflow](investigation-workflow.md)
- [Authoring verification](authoring-verification.md)

---

[Documentation](../README.md)
