# Catalog commands

The Catalog loads and validates `blackbox.config.yaml`, lists selectable boundaries, and resolves a structural plan. These commands do not acquire a live environment.

## List

```sh
blackbox catalog ls
```

List the validated entries in stable ID order. The document is validated, but listing deliberately does not check every referenced file on disk. A listed entry is not proof that the system can start.

## Validate

```sh
blackbox catalog validate
```

Validate document syntax, the canonical schema, semantic references, and referenced Compose, driver, and activation files. Referenced files must exist, remain within the real project root, and be regular files.

A success establishes this static preflight only. It does not prove that a container image builds, a credential works, instrumentation loads, or a readiness route responds.

## Resolve the right project

Run from the intended project and use the installed help for its path/output options. Do not assume every command supports `--config` because the separate Feature command family does.

Keep `blackbox.config.yaml` distinct from `blackbox.feature.yaml`: the first describes runnable systems; the second selects Feature inputs, output paths, and Sandbox profiles for compilation.

Next: [Catalog guide](../../systems/catalog.md) · [Schema](../config-schema.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/catalog/README.md).

---

[Documentation](../../README.md)
