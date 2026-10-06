# Installation and source preview

Most users should give [onboarding](agent-onboarding.md) to their coding agent. This page is the installation reference the agent and advanced users can follow.

## Source installation

At the audited revision, the main package says it is not yet published. Do not assume the npm `next` tag resolves merely because a package name appears here.

Use an approved checkout of this repository. From its root:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm build
node packages/cli/bin/run.js --help
```

The root manifest pins pnpm 9.15.4 and requires Node >=22.15. Do not change the lockfile, downgrade dependencies, or publish packages as an installation workaround. Check the launcher in the checkout before using it from another directory.

The source launcher uses the workspace's declared composition. An installed launcher uses its consumer's declared dependencies. Those are different installation contexts; a command available in the monorepo is not proof that the same package is selected in an external project.

## Release installation model

The intended released installation is:

```sh
npm install --save-dev @suites/blackbox@next @suites/blackbox-cli@next
```

Use the project's own package manager and compatible pinned package versions once a release is actually available. Declare the CLI directly; the main composition has no executable of its own.

| Capability | Package |
| --- | --- |
| Default composition and entry skill | `@suites/blackbox` |
| `blackbox` executable | `@suites/blackbox-cli` |
| Interactive execution | `@suites/blackbox-capsule` |
| Native system tests | `@suites/blackbox-playwright` and `@playwright/test` |
| Node runtime observation | `@suites/blackbox-inst-runtime-node` |
| Project driver authoring | `@suites/blackbox-driver` |
| Feature compiler | `@suites/blackbox-gherkin` — private incoming preview |

Do not install every package indiscriminately. The agent selects the capabilities needed by the project.

## Copy skills and prepare runtime support

With the relevant packages selected:

```sh
blackbox skills list --json
blackbox skills install blackbox --codex
blackbox skills install discovery --codex
blackbox skills install catalog --codex
blackbox skills install capsule --codex
blackbox inst install --runtime node
blackbox driver install --runtime node
```

The Capsule command needs its package; instrumentation and driver installation likewise need their providers. Skill copying never downloads missing feature packages. Node driver preparation does not install `curl`, `psql`, or `redis-cli`.

## Maintainer registry consumers

`scripts/consumer/prepare.mjs` is a maintainer harness, not a general installer. It expects the version in `lerna.json` to have already been published to a test registry; its default registry is local. It neither builds nor packs the workspace. Do not point it at production infrastructure or publish packages without explicit release authorization.

Next: [Skills](../agents/skills.md) · [First verification](first-verification.md).

## Source contract

[Toolchain](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/package.json). [Composition](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/blackbox/README.md). [Consumer harness](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/scripts/consumer/prepare.mjs).

---

[Documentation](../README.md)
