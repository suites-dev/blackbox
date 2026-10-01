---
name: blackbox-boundary
description: Select and justify a small reproducible behavioral SUT with conservative prerequisite closure.
---

# Behavioral boundary and SUT reduction

Read [reduction logic](../../references/sut-reduction.md) and
[the graph contract](../../references/operating-contract.md).

## Procedure

1. Fix the accepted question, initial state, entry nodes, terminal predicates,
   required observation and time budget before selecting participants.
2. Start with the intersection of forward behavioral reachability from entries
   and backward reachability from terminal witnesses. Treat this as a candidate,
   not a complete executable slice.
3. Expand through startup, execution, observation, reset and cleanup prerequisites.
   Keep conditional/unknown dependencies until resolved. Inspect off-path shared
   state, auth, migrations, timers and configuration that can affect the result.
4. Preserve separate deployment, lifecycle-control and behavioral views. Do not
   include a service only because it is colocated. Do not remove an essential
   worker because direct invocation is easier.
5. Explain each inclusion/exclusion and substitution. Replacing a dependency
   requires explicit approval and stated preserved behavior/limitations. An
   unmanaged production connection is not the default alternative to local setup.
6. With execution permission, establish a positive baseline, then try bounded
   reductions with fresh state and unchanged predicates. Retain a reduction only
   when its evidence supports the same scoped claim. Inconclusive means keep it.
7. If the question is underspecified, inventory a wider source-backed boundary;
   do not infer a passing claim. Runtime evidence can refine, not prove all paths.

## Return

Return a selected/unselected boundary, closure gaps, alternatives in evidence,
substitutions, confidence reasons and limitations. The included TypeScript helper
proposes a conservative candidate; it does not run minimization or claim a global
minimum. Never use numerical confidence as a substitute for receipts.
