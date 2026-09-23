# Run a bounded Capsule experiment

Use this reference when the user asks to explore one behavior interactively. A Capsule is a retained experiment with an ephemeral application environment. The environment is stopped when the experiment ends; its record remains.

## Define a question the experiment can answer

Before starting, identify the selected catalog system or subsystem, the concrete question, required participants, safe initial state, operation, relevant observation boundary, and cleanup expectation. A useful question is “Does this checkout request produce a correlated order request from checkout-api?” “Verify all of checkout” is too broad unless the user names the expected claims and evidence.

An intent or title describes the experiment. It is not an assertion or a product expectation. Keep each expected claim tied to an accepted user or test requirement. An experiment can reveal candidate behavior without deciding whether that behavior is correct.

Reuse the root catalog. Do not define a separate experimental Compose topology or start a second acquisition path for Capsule. Check whether the installed public CLI and package provide the required operation before invoking it. The Alpha concept surface is Capsule `start`, `curl`, `exec`, `effects`, `checkpoint`, `stop`, and `report`; the exact arguments and some outputs remain implementation-specific. Do not infer arguments from superseded commands or proposed CLI examples.

## Preserve identity and activity boundaries

Capture the actual Capsule ID returned by the installed start operation and use that ID for later operations. Retain each Activity ID, action, delegated process or HTTP result, and supported observation. Do not infer an ID from a title, filename, timestamp, or the newest retained run.

Keep setup, stimulus, and diagnostic work separately understandable. Seeding data can be necessary, but seed success is only a command result unless a supported observation says more. A role label describes purpose; it is not a read-only guarantee or permission to rewrite where an effect came from. A failed child command does not erase other Activities or permit the experiment to be rewritten as a success.

For each operation, keep distinct:

- the CLI's own status and payload;
- the child process exit or HTTP response;
- runtime capture state;
- any evaluator result that the installed product actually recorded;
- your interpretation of what those facts support.

A successful CLI or HTTP response does not establish a business outcome. An observed HTTP dispatch does not prove remote receipt or settlement. A database statement does not prove the expected values were committed. A queue send does not prove that a worker completed.

## Read effects carefully

Use the installed, versioned public effect view for the exact Activity and Capsule. Confirm the service, operation, target, origin, execution binding, and any qualification the producer exposes. Retain capture limitations. An empty list can mean no matching effects, unavailable projection, incomplete observation, or an unsupported reader; determine which from the producer instead of choosing the interpretation that best fits the task.

For async work, record the input action separately from downstream observations. Attribute downstream work only through supported correlation or explicit producer links, never just by a close timestamp or a matching user identifier.

If the installed surface cannot filter by the requested Activity or expose the evidence needed to answer the question, report that limit. Do not add an undocumented flag or build an agent-side verdict.

## Interpret and stop

A Checkpoint is human or agent commentary attached to a real Capsule identity. It can summarize a bounded interpretation and cite actual retained IDs, but it is not evidence, a check result, or a way to change earlier Activities. Do not invent a Checkpoint command shape or retrofit a finalized report.

Stop the known Capsule using its installed public operation after the experiment. Confirm the cleanup outcome and any remaining owned resource. Do not globally prune containers or remove unrelated state. The retained Capsule and Activity records should remain inspectable after teardown.

Reports are read-only projections. For a Capsule report, use the exact Capsule ID where the installed implementation supports it. Keep report-generation success separate from application or capture success. Return the question, selected boundary, exact IDs, actions and outcomes, supported observations, capture gaps, cleanup status, and what remains unknown.

Do not change code or baselines unless the user requested that work. When a useful experiment becomes a native test, author a separate test with independent fixtures and state; do not rely on the stopped Capsule's residual state.
