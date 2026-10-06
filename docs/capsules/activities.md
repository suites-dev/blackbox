# Activities

An Activity is one command admitted through Capsule execution. It records what was requested and what the delegated process reported. It is not automatically a behavioral assertion.

## Purpose

Use `setup` for migrations and seeding, `stimulus` for the action under investigation, and `inspection` for measurements. The default is `stimulus`.

```sh
blackbox capsule run --session "$SESSION_ID" --purpose inspection \
  --name 'Read subscription state' --via postgres -- psql -c 'SELECT count(*) FROM subscriptions'
```

The SQL and driver name above are project-specific. The command is an explicit state measurement only if that table, query, connection, and timing answer the claim. An exit status of zero alone is not the assertion.

## Host versus participant

Without `--via`, Capsule runs the command on the host. With a catalog driver, preparation can resolve connection details, execution location, trace context, and redaction. The driver must preserve the original executable.

Inspect the working directory and environment before running a destructive command. A driver targeting a participant does not make every database or service in the developer's environment disposable.

## Retained result and exit code

`capsule run` passes through the child process's exit status; Blackbox failures use 125 in the audited facade. Keep the CLI error, child stderr/stdout, activity identity, propagation outcome, and downstream evidence separate.

`--wait` bounds the telemetry wait after the process finishes. It is not an application job timeout or an assertion deadline. `--allow-untraced` is an explicit propagation override, not a way to claim that trace linkage succeeded.

## Output safety

The default output is redacted according to known secret declarations. `--raw-output` with JSON bypasses credential redaction for captured child output; do not use it in shared logs or public evidence. Arbitrary application output can still contain undeclared sensitive data.

Direct commands run outside Blackbox are not automatically Activities. Preserve this distinction in reports instead of reconstructing successful activity records after the fact.

## Source contract

[CLI contract](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/src/cli/commands/capsule/run.ts). [Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/driver/README.md).

---

[Documentation](../README.md)
