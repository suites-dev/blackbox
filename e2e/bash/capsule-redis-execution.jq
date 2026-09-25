.kind == "capsule-exec-completed" and
.outcome.kind == "driver-completed" and
.outcome.propagation.expectation.kind == "shared-state-propagation-unsupported" and
.outcome.propagation.expectation.resource == "redis" and
.outcome.propagation.outcome.kind == "context-not-supported" and
.outcome.propagation.outcome.boundary == "shared-state" and
.outcome.propagation.outcome.resource == "redis" and
.outcome.process.kind == "exited" and
.outcome.process.exitCode == 0 and
.outcome.process.location.kind == "participant" and
.outcome.process.location.participantId == "redis" and
.outcome.process.stdout == "1\n"
