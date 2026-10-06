# Systems

Before Blackbox can investigate or verify software, it needs a runnable description of the system. The agent discovers that description and records it in `blackbox.config.yaml`.

```text
Repository -> Discovery -> Catalog entry -> Capsule or Playwright Sandbox
                               |                    |
                            boundary          controlled execution
```

## What the description contains

A Catalog entry names a system or subsystem, its Compose acquisition files, participants, entrypoint/readiness, project drivers, and observation declarations. Runtime activation assets are referenced separately.

Compose describes how services run. The Catalog describes how Blackbox selects and works with them. It does not replace application deployment configuration or infer every dependency from a package manifest.

## What the agent should handle

The agent can inspect repository startup conventions, select the smallest useful boundary, validate paths and references, and configure supported interaction and observation. The human approves execution scope, external access, and any changes to accepted behavior.

A valid catalog is a static result. A successful startup is an execution result. A passing behavioral check needs its own evidence. Keep those stages separate when explaining setup.

## Guides

Read [Discovery](discovery.md), [Catalog](catalog.md), and [configuration](blackbox-config.md) for system modeling. Use [system boundaries](system-boundaries.md) to choose scope, [drivers](drivers.md) to adapt commands, and [instrumentation](instrumentation.md) to observe supported processes.

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/catalog/README.md).

## Pages in this section

- [Discovery](discovery.md)
- [Catalog](catalog.md)
- [blackbox.config.yaml](blackbox-config.md)
- [System boundaries](system-boundaries.md)
- [Drivers](drivers.md)
- [Instrumentation](instrumentation.md)

---

[Documentation](../README.md)
