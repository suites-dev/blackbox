# Capsules

![Two execution paths into a selected system](../assets/figures/readme-machine-dark.svg)

Conceptual flow: it does not depict an automatically proven verdict.

A Capsule is a controlled running system for an investigation. The experiment is the procedure performed inside it; it is not a separate CLI object.

Use this path when the agent needs to understand a failure, try a hypothesis, or inspect runtime behavior before deciding which checks to retain. Use [Playwright](../playwright/index.md) directly when the expected behavior and test are already known.

## Lifecycle

```text
select system -> up -> setup -> stimulus -> inspection -> report -> down
                         |                    |
                         +---- another trial -+
```

Starting a Capsule admits an identified session and acquires the selected Catalog boundary. A detached manager owns its live resources and coordinates commands and cleanup. Stopping it releases owned runtime resources while retaining records.

Reuse during an investigation is not automatic state reset. Before another trial, restore the agreed initial conditions or create a new Capsule. A code edit does not guarantee that a running container has loaded the new implementation.

## What is retained

A session records lifecycle and resource ownership. Activities record admitted commands, purpose, process results, and propagation information. Progress and Sandbox/collector artifacts retain supporting observations.

By default, session records live below `.blackbox/experiments/capsule-<session-id>/`. Reports are projections of those records, not a separate source of truth.

## Scope and permissions

A Capsule is isolation for a selected test environment, not a security sandbox for arbitrary repository code. Obtain approval for image pulls, builds, host commands, mounts, listening ports, external services, and cleanup. Stop only resources associated with the known session.

Next: [Run an experiment](experiments.md) · [Activities](activities.md) · [Reports](reports.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/README.md).

## Pages in this section

- [Run a Capsule experiment](experiments.md)
- [Activities](activities.md)
- [Capsule reports](reports.md)

---

[Documentation](../README.md)
