# Driver installation

```sh
blackbox driver install --runtime node
```

Prepare the project-local driver area and verify the Node authoring SDK. The implemented authoring runtime is Node; the protocol contract is separate from the language of the application being tested.

## What remains project-owned

The agent authors the actual adapter module, declares it in `blackbox.config.yaml`, and ensures the target executable is available where it runs. Installation does not create HTTP/Postgres/Redis business actions or install curl, psql, or redis-cli.

A driver named `public-api` or `postgres` is a catalog choice, not a universally built-in command name. Use the repository examples as a reference and adapt them to the actual system.

## Execution

```sh
blackbox capsule run --session <id> --via <driver> -- <command> <arguments>
```

The driver prepares connection information, context propagation, and redaction while preserving the requested executable. Capsule owns execution and retention.

Project driver code is trusted Node code, not a contained plugin sandbox. Review it and authorize its scope before execution.

Next: [Driver guide](../../systems/drivers.md) · [Capsule flags](capsule.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/driver/README.md).

---

[Documentation](../../README.md)
