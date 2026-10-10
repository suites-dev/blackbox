---
name: catalog
description: Author or reconcile the project catalog against the installed Blackbox contract.
---

# Catalog authoring

Read [capabilities](references/capabilities.md). Root `blackbox.config.yaml`
is the only project-authored Blackbox topology authority.

## Procedure

1. Resolve the installed version's public JSON Schema and semantic/reference
   validator. In a source checkout the config schema is
   `packages/catalog/schema/blackbox-config-v1.json`. Do not assume an online
   schema or copied example matches the installed package.
2. Map the approved behavioral boundary to a `system` or `subsystem`, ordered
   Compose acquisition files, participants, entrypoint/readiness, drivers,
   observation policy and root activations, using supported fields only.
3. Verify every participant-to-service mapping, driver target and execution
   location. Check build/start source, file containment, protocol/port and
   activation compatibility. A Node driver runtime does not identify the SUT's
   implementation language.
4. Preserve Compose file order and user edits. Avoid invented `x-blackbox`
   metadata, a second service graph or new YAML fields for audit classifications.
5. Keep observation requirements truthful. A declaration or installed bootstrap
   is not a receipt that observations arrived.
6. Stage the narrow authorized edits, recheck input digests, apply without losing
   concurrent changes, then use the installed catalog validator. Return conflicts
   rather than overwriting edited driver/instrumentation files.

## Return

Record the selected entry, schema identity and catalog content digest. Keep source
reasoning, ownership, confidence and unresolved facts in the audit. The current
HTTP-readiness limitation must block unsupported queue-only acquisition, not be
hidden by a fictional endpoint or schema extension.

Use [topology and catalog](references/topology-and-catalog.md) for current supported
configuration conventions. Return the selected entry, changed paths, schema and
validation result to the caller; live execution belongs to the available Capsule
skill. Missing Capsule does not block catalog authoring or static validation.
