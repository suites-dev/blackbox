# Install Blackbox

Install Blackbox in the project that owns your system tests. The examples use
npm and the `alpha` distribution tag. Keep Blackbox packages on compatible
versions and commit your lockfile so local development and CI use the same release.

## Before you begin

- Install Node.js 22.15 or later, which includes npm.
- For execution, start Docker with Compose and confirm `docker info` succeeds.
- Allow package downloads and container image pulls on the first run.

API-only tests do not need a browser download. See [compatibility](alpha-status.md)
for runtime requirements and optional APIs.

## Start agent onboarding

From your application root, start the guided setup:

```sh
npx @suites/blackbox-cli@alpha onboarding start
```

Follow the workflow to set up your coding agent and prepare the application for
verification. See [onboarding and agent skills](agent-skills.md) for the next steps.

For the standalone first-test tutorial, create a project and install the packages below.

## Create a test project

For the [first-test tutorial](getting-started.md), choose an unused directory:

```sh
mkdir blackbox-first-test
cd blackbox-first-test
npm init -y
npm pkg set type=module
```

For an existing project, keep its manifest and run the installation below from
its root.

## Install the Playwright package

```sh
npm install --save-dev @suites/blackbox@alpha @suites/blackbox-cli@alpha
npm install --save-dev @suites/blackbox-playwright@alpha @playwright/test
```

Check the installed CLI:

```sh
npx blackbox --help
```

The base package selects Catalog, Discovery, and Skills. The CLI package exposes
the `blackbox` executable, and the Playwright adapter supplies the test fixtures
and reporter. Transitive runtime dependencies are installed by the package manager.

Run `npx blackbox` from the project root so commands use that project's
configuration. Continue with [Run your first system test](getting-started.md).

## Add optional integrations

For interactive Capsule experiments:

```sh
npm install --save-dev @suites/blackbox-capsule@alpha
```

For Node application instrumentation:

```sh
npm install --save-dev @suites/blackbox-inst-runtime-node@alpha
npx blackbox inst install --runtime node
```

Connect the installed instrumentation to the appropriate catalog participants as
described in [application setup](playwright/connect-your-application.md). Installing
an integration selects its commands; the catalog defines how the application uses it.

| Package                              | Responsibility                                                   |
| ------------------------------------ | ---------------------------------------------------------------- |
| `@suites/blackbox-cli`               | The `blackbox` executable; declare it directly.                  |
| `@suites/blackbox`                   | Catalog, Discovery, Skills, and the entry skill.                 |
| `@suites/blackbox-playwright`        | Native Playwright adapter and reports.                           |
| `@suites/blackbox-capsule`           | Interactive experiments and Capsule reports.                     |
| `@suites/blackbox-inst-runtime-node` | Node instrumentation installer.                                  |
| `@suites/blackbox-effects`           | Standalone effects projection, contract evaluation, and records. |
| `@suites/blackbox-driver`            | SDK for project-owned Capsule drivers.                           |

Add a package directly when your code imports it or your CLI needs its commands.
A package's presence as an indirect dependency does not select it as a CLI provider.
See [CLI composition](../packages/cli/README.md#runtime-composition).

## Install the SDK for project drivers

For `capsule run --via`, install the driver package and prepare its project-local
runtime from your test-project root:

```sh
npm install --save-dev @suites/blackbox-driver@alpha
npx blackbox driver install --runtime node --json
```

The installer prepares `.blackbox/drivers`, installs its SDK dependency, and
preserves project modules. Existing SDK version declarations are retained; keep
them compatible with the other Blackbox packages. The [driver guide](drivers.md)
covers module authoring and catalog registration.

## Resolve installation failures

| Symptom                         | Check                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `blackbox` command not found    | Install `@suites/blackbox-cli` directly and use `npx blackbox`.                                       |
| CLI command absent              | Install the owning integration in this project's manifest and check [compatibility](alpha-status.md). |
| Import or peer dependency error | Check the installed Blackbox and Playwright versions against their package requirements.              |
| Docker cannot be reached        | Start Docker and check access before interpreting test results.                                       |

To work on Blackbox itself, use [the contributor setup](../CONTRIBUTING.md#set-up-and-validate).

[Agent skills](agent-skills.md) · [Configuration](configuration.md) · [Support](../SUPPORT.md)
