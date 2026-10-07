# Installed Capsule capabilities

Inspect `blackbox capsule --help` and the exact subcommand help. Current routes
are `blackbox capsule up <system> --json` (returns `sessionId`),
`blackbox capsule run --session <id> -- <command...>`,
`blackbox capsule show <id>` (a capsule, activity or trace ID),
`blackbox capsule down <id>`, `blackbox capsule report <id>`,
`blackbox capsule report export --session <id> --format html` (or `json`), and
`blackbox capsule report serve --session <id>`. `blackbox capsule ls` and
`blackbox capsule use <id>` list and select capsules. Capture returned identities and
inspect command and child outcomes independently. See
[the procedure](capsule-experiments.md). Do not infer activation/readiness support
from a configured protocol or runtime name.

<!-- skill-lint: not-available -->

Older docs name `blackbox observations` and `blackbox history`; they are hidden, unsupported commands.
Use `blackbox capsule show <id>` instead.
