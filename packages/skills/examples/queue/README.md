# Queue example

The illustrated behavior begins at an input queue, passes through a worker and ends at an output queue, retaining required PostgreSQL state. A real installation still needs supported startup readiness. This example does not invent a queue-native readiness field.

[audit.json](audit.json) and [receipts.json](receipts.json) are synthetic contract
vectors. Their IDs, digests and artifact paths are illustrative; there are no raw
runtime artifacts behind them. `provenance.kind` remains `example`. They demonstrate
record shapes and negative-test inputs, not an executed application or a copyable
complete project catalog. Use the installed catalog schema and your project's real
Compose, drivers and activation assets for actual setup.
