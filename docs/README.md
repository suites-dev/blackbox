# Blackbox documentation

Blackbox helps you construct controlled experiments around real applications. Define a question, choose the system
boundary and initial conditions, apply a stimulus, and assess the evidence from the resulting execution.

A Capsule provides the laboratory in which you work. Start with [the verification machine](verification-machine.md)
for the distinction between the environment, the experimental procedure, and a particular trial.

## Start an investigation

[Install Blackbox](installation.md) and follow [your first Capsule](getting-started.md).
The tutorial takes you through a subscription request, observation queries, a report, and cleanup.

Already have an application to investigate? Start with [configuration](configuration.md), then use
[Capsule experiments](experiments.md) to exercise it with your own commands.

## Understand the workflow

| Concept        | Meaning                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| System catalog | The applications and subsystems you can select, with their participants and configuration. |
| Capsule        | The controlled environment, tools, sensors, and retained execution record.                 |
| Experiment     | The procedure: initial state, conditions, stimulus, observations, and decision rules.      |
| Trial          | One execution of that procedure.                                                           |
| Activity       | A command you perform for setup, stimulus, or inspection, with its recorded result.        |
| Observation    | A measured response, runtime operation, command result, or state.                          |
| Report         | A view or snapshot of the retained execution record.                                       |

## Guides and reference

| Guide                                               | Use it to…                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| [The verification machine](verification-machine.md) | Design an experiment and keep its claims distinct from its evidence.    |
| [Configuration](configuration.md)                   | Describe the system and its instrumentation.                            |
| [Instrumentation and adapters](instrumentation.md)  | Install instrumentation and load it into participants.                  |
| [Drivers](drivers.md)                               | Prepare commands, choose execution locations, and propagate context.    |
| [Capsule experiments](experiments.md)               | Start a session, perform actions, query observations, and stop it.      |
| [Runtime evidence](runtime-evidence.md)             | Interpret what observations establish and where correlation is limited. |
| [Async holes and Redis](async-workflows.md)         | Inspect an asynchronous entrypoint across separate traces.              |
| [Reports](reports.md)                               | Browse an experiment or export JSON and HTML.                           |
| [CLI reference](cli.md)                             | Find command syntax and output behavior.                                |
| [Alpha availability](alpha-status.md)               | Check supported workflows and preview limitations.                      |
| [Support](../SUPPORT.md)                            | Get help or report a problem.                                           |

Blackbox is an alpha preview distributed from source. Playwright integration is in progress.
To contribute to the project, see [contributing](../CONTRIBUTING.md).
