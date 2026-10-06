# Limitations and causality

Blackbox should preserve what the evidence establishes, including when it cannot link two events causally.

## The shared-state example

An agent pushes work into Redis. A consumer later sends an HTTP request. Both appear in the same Capsule, but the shared-state handoff did not carry trace context. The later request may be visible on a separate trace.

The record can show the Redis activity and the downstream HTTP observation. It must not invent a parent-child trace link between them. “Same Capsule” and “later timestamp” are not enough to establish that the first caused the second.

## Other evidence can still be useful

A controlled initial state, isolated workload, unique business identifier, and explicit completion state can support a bounded behavioral conclusion across traces. Describe that reasoning and its assumptions separately from a claim of direct trace causality.

The catalog can declare a W3C propagation carrier or a shared-state limitation. A driver's `context-injected` result records preparation; received telemetry must establish whether the application continued that context.

## Distinguish common gaps

| Gap | Consequence |
| --- | --- |
| Observer not installed in the process doing the work | That process's operations may be absent |
| Context not propagated | Downstream work may be separately traced |
| Export delayed or truncated | Counts and absence checks may be premature |
| External dependency shared with other runs | Session isolation does not isolate the external effect |
| State read before completion | A correct later result can look missing |
| Runtime source lacks an attribute | Do not infer operation or outcome from a convenient name |

## Report the limitation precisely

Prefer “The consumer request was observed, but this capture does not establish a direct link to activity X” to either “nothing happened” or “X caused Y.” Keep the action result, observed activity, interpretation, and missing proof separate.

A stronger statement may need a new observer, a propagated business identifier, an authoritative state reader, or a different experimental boundary. The agent should propose that change, not silently strengthen the conclusion.

## Source contract

[Propagation contract](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/driver/README.md). [Experiment procedure](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/references/capsule-experiments.md).

---

[Documentation](../README.md)
