# Install Blackbox

`@suites/blackbox` is the default entry package. It includes the CLI, skill
installer, Catalog, Discovery, and the `$blackbox` skill. Add execution adapters
separately, then run Blackbox from the application you want to investigate.

> **Alpha distribution:** The release infrastructure is prepared, but this change
> does not publish packages to npm. Use the source installation until an alpha is
> explicitly released.

## Choose packages

After the alpha is published, the installation model is:

```sh
npm install --save-dev @suites/blackbox@next
# Choose the execution adapters your project uses:
npm install --save-dev @suites/blackbox-capsule@next @suites/blackbox-playwright@next
```

These are release commands, not a claim that the packages are available today.
Prereleases use the `next` distribution tag. Use your existing package manager and
compatible package versions.

| Package                              | When to add it                                                 |
| ------------------------------------ | -------------------------------------------------------------- |
| `@suites/blackbox`                   | Default CLI, static discovery, Catalog, and skill installation |
| `@suites/blackbox-capsule`           | Interactive execution, observations, and Capsule reports       |
| `@suites/blackbox-playwright`        | Native Playwright system-test fixtures                         |
| `@suites/blackbox-inst-runtime-node` | Node instrumentation installation                              |
| `@suites/blackbox-driver`            | Project-owned driver runtime and SDK                           |

The main package does not install execution adapters. An uninstalled adapter
contributes no commands or skills. Internal Sandbox and telemetry dependencies
are installed by the adapters that need them.

After installation, use the project-local executable, for example
`pnpm exec blackbox --help`. To copy the entry skill for Codex:

```sh
pnpm exec blackbox skills install blackbox --codex --gitignore
```

This copies instructions, not packages. Use `--cursor` or `--claude` for those
hosts; see [agent skills](agent-skills.md).

## Build from source

### Prerequisites

- Git, Node.js 22.15 or newer in the Node 22 line, and pnpm 9.15.4.
- Docker with Compose for execution adapters; not needed for static skill use.
- Bash or Zsh, plus `jq` and `curl` for the tutorials.
- Network access to download dependencies and container images.

Start Docker and check that `docker info` succeeds before running a Capsule.
The first application startup may take several minutes while images download and build.

On Windows, use Docker Desktop and Git Bash, and keep two host limits in mind:

- Clone to a shallow directory such as `C:\src\blackbox`. Docker Desktop returns `EIO` to non-root containers
  for bind mounts whose Windows source path has 17 or more components, and Capsule telemetry storage sits about
  six levels below the project directory.
- Git Bash rewrites arguments that start with `/`, such as the driver examples' `/subscriptions`, into Windows
  paths. Run `export MSYS_NO_PATHCONV=1` and define the shortcut below with `blackbox_checkout="$(pwd -W)"` so
  the checkout path is already in Windows form.

### Build and select the executable

```sh
git clone https://github.com/suites-dev/blackbox.git
cd blackbox
pnpm install --frozen-lockfile
pnpm build
```

Use the same branch as the documentation you are following.

Make the source build available in your current terminal:

From the Blackbox checkout, define a shell shortcut:

```sh
blackbox_checkout="$PWD"
blackbox() { node "$blackbox_checkout/packages/blackbox/bin/run.js" "$@"; }
blackbox --help
```

You should see the CLI help, including `capsule`, `catalog`, and `skills`.
The source checkout deliberately selects all of its declared workspace providers.
That is broader than a consumer installing only `@suites/blackbox`.
Blackbox uses the current directory as the project root: it reads
`blackbox.config.yaml` there and retains experiment data under `.blackbox/`.

The shortcut uses an absolute path to your build, so you can change into another project directory and run `blackbox` there.
It is defined only for this terminal session. In a new terminal, return to the checkout and define it again.

Continue with [your first Capsule](getting-started.md) or [configure an application](configuration.md).

## Install the SDK for project drivers

Skip this section if you only use host commands without `--via`. To use or author
project drivers, install their SDK alongside the project's driver modules. The
guided demo handles this step automatically for its own run.

For a source installation, first package the SDK and its telemetry dependency from
your completed build:

```sh
mkdir -p "$blackbox_checkout/.blackbox/driver-packages"
pnpm --config.ignore-scripts=true --dir "$blackbox_checkout/packages/telemetry" \
  pack --pack-destination "$blackbox_checkout/.blackbox/driver-packages"
pnpm --config.ignore-scripts=true --dir "$blackbox_checkout/packages/cli-contract" \
  pack --pack-destination "$blackbox_checkout/.blackbox/driver-packages"
pnpm --config.ignore-scripts=true --dir "$blackbox_checkout/packages/driver" \
  pack --pack-destination "$blackbox_checkout/.blackbox/driver-packages"
```

For the included application, enter its project directory:

```sh
cd "$blackbox_checkout/e2e"
```

For your own application, use its project directory instead. Then install both local packages and prepare the runtime:

```sh
npm install --prefix .blackbox/drivers --ignore-scripts --no-audit --no-fund \
  "$blackbox_checkout/.blackbox/driver-packages/suites-blackbox-telemetry-0.0.1-alpha.0.tgz" \
  "$blackbox_checkout/.blackbox/driver-packages/suites-blackbox-cli-contract-0.0.1-alpha.0.tgz" \
  "$blackbox_checkout/.blackbox/driver-packages/suites-blackbox-driver-0.0.1-alpha.0.tgz"
npm pkg set --prefix .blackbox/drivers \
  'overrides.@suites/blackbox-telemetry=$@suites/blackbox-telemetry'
blackbox driver install --runtime node --json
```

The filenames above match the first alpha. Use the filenames printed by `pack` if
your checkout has a different version. Keep the tarballs available for subsequent dependency installs.
The override keeps the SDK's telemetry dependency pointed at the local package during later installs.

For the included application, the project directory is `$blackbox_checkout/e2e`; its driver modules are already
provided. Continue with the [subscription investigation](experiments.md).
