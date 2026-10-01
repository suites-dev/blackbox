# Behavioral SUT reduction

The objective is a small reproducible Capsule that answers a fixed behavioral
question. "The smallest container set that starts" is a different objective.

## Graph model and candidate selection

Let `V` contain participants/resources and supporting source/package nodes.
Let `E_b` be behavioral edges, `E_r` prerequisite edges, and `E_d` deployment
relationships. Let `I` be accepted input nodes and `W` required terminal nodes.

A useful seed is the bidirectional behavioral slice:

```text
B0 = I union W union (Reach_forward(I, E_b) intersection Reach_backward(W, E_b))
B(k+1) = B(k) union RequiredPrerequisites(B(k))
B* = least fixed point of that expansion
```

A prerequisite can be needed for build, startup, execution, observation or cleanup.
Include migrations, initial state, authentication/configuration, shared state and
observation resources even when they are not on a direct input-to-output path.
Conditional and unknown prerequisites stay in the conservative proposal until
resolved. Deployment colocation alone adds nothing to `RequiredPrerequisites`.

If no evidenced path reaches a required terminal, return an unresolved/invalid
proposal. Do not manufacture an edge to make a graph connected. The included
`proposeBoundary` and `dependencyClosure` helpers implement this conservative
proposal, not a program slicer or optimizer.

## Cost subject to preservation

A design objective can be written as:

```text
minimize cost(B) + lambda * substitutionRisk(B) + mu * unresolvedRequirements(B)
subject to:
  accepted inputs and terminal predicates remain represented;
  required startup/state/observation/cleanup prerequisites are satisfied;
  each substituted boundary has an explicitly accepted contract and limits;
  isolation, permissions, completion and evidence requirements remain satisfied.
```

These are design constraints, not a theorem that one observed passing trial
preserves every execution. Numeric weights rank candidate costs, not probability
of correctness. Unresolved mandatory dependencies cannot be traded away by a
lower cost. Do not optimize a minimum cut that simply removes the behavior being
tested. Steiner-like connectivity can motivate heuristics, but connectivity alone
does not preserve effects, temporal behavior, error paths or external contracts.

For a chosen input domain `D` and required witness projection `P`, the desired
preservation relation is conceptually:

```text
for each accepted initial state and input in D:
  P(behavior(full, state, input)) agrees with P(behavior(reduced, state, input))
```

A finite test campaign only supplies evidence for the exercised states, inputs and
schedules. Keep omitted domains, nondeterminism and substitution assumptions explicit.

## Hybrid procedure

```text
inspect sources and accepted question
resolve capabilities and permissions
seed from inputs and terminal witnesses
expand required prerequisites to a fixed point
if prerequisites or behavior are unknown: retain them and report uncertainty
validate one positive baseline in a fresh Capsule, when authorized
for each candidate removal group within the execution budget:
    reject cuts across protected predicates or unsatisfied prerequisites
    restore initial conditions; run the unchanged procedure
    if terminal, observation and cleanup evidence support the same claim:
        retain the reduction and its receipts
    otherwise:
        restore the participant group; record failed or inconclusive evidence
return selected boundary, scoped confidence and limitations
```

Use a wider known-working, source-backed boundary when no useful behavior is
specified or the small candidate cannot be acquired. Once the question is fixed,
reduce incrementally. Start wide in evidence collection, narrow in claims, and
expand execution only when required and permitted.

## Other graph techniques

Strongly connected components of mandatory prerequisites can identify groups
that cannot be removed independently. Do not treat every communication cycle as
an indivisible lifecycle group. Dominators/post-dominators can suggest important
control points in an appropriate control-flow model; arbitrary service graphs lack
those semantics. Dynamic traces provide occurrence evidence but miss unexercised
branches. No single static/dynamic graph supplies all prerequisites.

Delta debugging inspires repeated removal against a fixed oracle. A completed
single-element reduction can establish only 1-minimality relative to its removal
units and oracle. It need not find a globally cheapest SUT. Nondeterministic,
failed or incomplete validation is not permission to remove a dependency.

## Examples

For `API -> billing -> payment gateway -> persisted order`, preserve billing,
accepted gateway interaction and the database if they are part of the question.
A payment emulator changes the claim to the emulator's contract. Removing an
unrelated notification service is safe only after required side effects and
startup/shared-state prerequisites are accounted for.

For `input queue -> worker -> output queue`, an API front door can be excluded
when the question begins at the input queue. The worker, broker/resources,
configuration and any required database remain. Directly calling a worker method
would no longer test queue delivery. A protocol-native readiness gap is a
capability blocker, not evidence that an invented HTTP sidecar belongs in the SUT.

Sources: [Horwitz, Reps and Binkley on dependence graphs](https://research.cs.wisc.edu/wpis/abstracts/pldi88.abs.html),
[Zeller and Hildebrandt on delta debugging](https://doi.org/10.1109/32.988498).
The service-boundary formulation above is an application design, not a claim that
those papers prove distributed-system equivalence.
