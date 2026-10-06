# Catalog

The Catalog is the set of runnable systems and subsystems Blackbox knows how to operate. It is stored in `blackbox.config.yaml`, normally maintained by the coding agent and reviewed with the project.

## List and validate

```sh
blackbox catalog ls
blackbox catalog validate
```

Listing validates the document and lists entries in stable ID order. Validation also checks referenced Compose, driver, and activation paths for existence, regular-file shape, and containment in the project.

These operations do not start containers, probe readiness, execute drivers, or prove that instrumentation works.

## Entry selection

The catalog declares a default. Explicit selection names another entry. Each entry has `kind: system` or `kind: subsystem`; native Playwright's selection must agree with that kind.

```ts
test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', (suite) => {
    // Declare checks for this boundary.
  });
});
```

A selected boundary is not the state left by a previous execution. Capsule and Playwright can reuse the same description while acquiring independent environments.

## Structural resolution

Catalog loading and validation produce a typed description. Resolution selects ordered Compose files, services, endpoint/readiness requests, driver configuration, and metadata for the runtime layer.

Catalog does not own cleanup or assign live host ports. Capsule/Sandbox perform the runtime work and retain its outcome.

## Changes worth reviewing

Changing a participant, Compose file, driver target, activation, or observation declaration can change the conditions behind a test result. Review catalog changes alongside their effects on the claimed boundary. A smaller catalog is not automatically a better test if it removes behavior the requirement depends on.

Next: [YAML configuration](blackbox-config.md) · [Schema](../reference/config-schema.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/catalog/README.md).

---

[Documentation](../README.md)
