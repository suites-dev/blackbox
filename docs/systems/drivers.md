# Drivers

Drivers adapt a caller-supplied command to a selected system boundary. They can add endpoint information, execution location, trace propagation, and secret-redaction declarations.

They are not a library of preapproved business actions, and they do not install protocol tools.

## Use a configured driver

```sh
blackbox capsule run --session "$SESSION_ID" --via public-api -- curl /health
```

The repository's example HTTP driver prepares the request for its selected endpoint. PostgreSQL and Redis example drivers execute the preserved `psql` or `redis-cli` command in the selected participant. Those names are project definitions, not universal built-ins.

## Install the authoring runtime

```sh
blackbox driver install --runtime node
```

This prepares the project driver area and verifies the local SDK. The agent still authors a driver and adds the catalog declaration. Do not assume this command installed curl or connected to a database.

## Preparation is not execution

A project module default-exports a `defineDriver(...)` definition whose name matches its Catalog driver ID. Preparation receives the original command and resolved target. Its validated result describes the prepared arguments, environment, propagation, and redaction. Capsule executes it afterward.

The prepared executable must remain the caller's executable. A driver must not turn a requested read command into another tool with broader authority.

## Propagation

For a supported W3C carrier, injection records what the driver prepared. Runtime observations must establish receipt and continued context. Shared-state boundaries such as Redis or PostgreSQL can declare unsupported direct propagation rather than inventing causal linkage.

`--allow-untraced` explicitly relaxes a propagation requirement for the action. Preserve that limitation in the result.

## Trust

The Node preparation process is bounded, but it is not a security sandbox. Driver code runs with Node capabilities and the Blackbox process environment. Review project drivers before execution. Redaction declarations protect known secrets; undeclared sensitive output still requires care.

Use the repository's working driver examples as the authoring reference rather than copying a generic incomplete preparation object.

Next: [Activities](../capsules/activities.md) · [Driver CLI](../reference/cli/driver.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/driver/README.md). [HTTP example](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/e2e/.blackbox/drivers/public-api.mjs). [Postgres example](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/e2e/.blackbox/drivers/postgres.mjs). [Redis example](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/e2e/.blackbox/drivers/redis.mjs).

---

[Documentation](../README.md)
