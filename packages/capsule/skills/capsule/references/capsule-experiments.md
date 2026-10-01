# Run a bounded Capsule experiment

A Capsule supplies the controlled environment, execution tools, observation, and retained record. An experiment is
the procedure performed there; a trial is one execution of that procedure. Stopping the Capsule releases its owned
environment while preserving its recorded activities and observations.

## Define the question and procedure

Identify the selected catalog system or subsystem, known initial state, stimulus, measurements, completion conditions,
accepted claims, and cleanup expectation. Select the smallest boundary that contains the behavior. A useful question
is “Under this setup, does submitting this job result in the expected downstream request?” Add direct trace causality
as a requirement only when the claim actually needs it.

A title or description is not an assertion. Discovery can suggest expectations; confirmation requires independently
accepted expectations and fresh evidence. Do not accept whatever happened merely because it was recorded.

Reuse the root catalog and supported acquisition path. Current commands are `capsule up <system>`,
`capsule run --session <id>`, `observations --session <id>`, `capsule down --session <id>`, and
`capsule report serve|export --session <id>`. Inspect installed help for other flags. There are no current
`capsule curl`, `capsule effects`, or `capsule checkpoint` operations.

## Preserve command and evidence identities

Capture the actual `sessionId` from startup and `activityId` from command results. Do not infer identity from a title,
timestamp, or the newest retained run. Use `--purpose setup|stimulus|inspection` to describe actions; these labels do
not restrict side effects. Drivers can prepare HTTP requests, database seeding or migrations, and Redis stimuli by
selecting targets, execution locations, connection settings, and supported context propagation.

Keep distinct the CLI status, delegated process output and exit, propagation outcome, received telemetry, state reads,
and your interpretation. A successful command does not establish every downstream consequence. Failed commands do not
erase other evidence.

## Inspect the whole execution when correlation has gaps

Session queries expose execution-scoped telemetry. Activity queries select correlated observations; trace queries select
an exact trace identity. An async handoff can leave relevant downstream work on another trace. Inspect the session as
well, preserving that limitation instead of inventing parentage or dropping the evidence.

Known initial state, isolation, a unique visible business identifier, and appropriate completion conditions may support
a behavioral claim across traces. Shared session membership alone does not attribute every span to a specific action.
An occurrence witness may be sufficient before all telemetry arrives; absence and exact counts need adequate coverage
and completion. Return insufficient evidence when the claim cannot be answered.

Current views expose raw observations and command results. Do not describe your own assessment as a product-generated
claim verdict or invent a normalized-effects API. Read the async reference for bounded waiting and competing work.

## Retain the result and close the loop

Report the question, conditions, exact identities, commands, evidence, limitations, and supported finding. A report is a
projection of retained records, not automatic acceptance of observed behavior. If repair is authorized, change the
implementation, restore the initial conditions, and rerun the same procedure against the accepted expectations.

Stop the known Capsule and inspect its cleanup result. Preserve unrelated containers and state. Keep the retained
record available after teardown. Do not modify code or accepted expectations beyond the user's requested work.
