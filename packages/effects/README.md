# Blackbox effects (experimental)

`@suites/blackbox-effects` is a **private, experimental** package. It defines the
shape of one record of the effects a single test attempt or Capsule activity
produced, so two runs can be compared without reading an HTML report.

The schema is `v0` and can change without notice. This skeleton only builds and
serializes a record; it does not read telemetry or normalize spans yet. Tracking
issue: [#187](https://github.com/suites-dev/blackbox/issues/187).

An effect is a normalized operation observed at a boundary (an HTTP request, a
database operation, a cache call or a message), counted over the record's scope.
The record states its completeness once. A missing effect only means "not
observed" when the record is `complete` and the observation covers that boundary.

## How this relates to what exists

- `packages/playwright/src/effects` holds the effects **contract**: what a test
  _expects_ (counts and order). This package holds what a run _produced_. The kinds
  are the same list (`EFFECT_KINDS`); a test checks the schema against it, but the
  two lists are copies and can still drift apart.
- The Capsule report keeps a bounded, redacted view of spans for people to read.
  This record is meant for comparison between runs, and starts from the retained
  telemetry, not from the report.
- It is a separate package so that both Playwright and Capsule inputs can feed it
  without either depending on the other. If the schema settles, folding it into one
  of them is a possible later step.

## Known open questions

- What identifies an effect (`kind`, `operation`, `target`, `outcome` is a first
  guess). Real data decides this.
- The record is count-based and throws order away. The contract can already say
  "A before B".
- Effect `target` for databases may be empty while the report does not keep
  statements.
