# Install Blackbox

`@suites/blackbox` is the default entry package for the core modules and `$blackbox`
skill. Install `@suites/blackbox-cli` explicitly for the `blackbox` command. Add execution adapters
separately, then run Blackbox from the application you want to investigate.

> **Alpha distribution:** The release infrastructure is prepared, but this change
> does not publish packages to npm. Use the source installation until an alpha is
> explicitly released.

## Choose packages

After the alpha is published, the installation model is:

```sh
npm install --save-dev @suites/blackbox@next @suites/blackbox-cli@next
# Choose the execution adapters your project uses:
npm install --save-dev @suites/blackbox-capsule@next @suites/blackbox-playwright@next
```

These are release commands, not a claim that the packages are available today.
Prereleases use the `next` distribution tag. Use your existing package manager and
compatible package versions.

| Package                              | When to add it                                                  |
| ------------------------------------ | --------------------------------------------------------------- |
| `@suites/blackbox`                   | Core composition, static discovery, Catalog, and agent skills   |
| `@suites/blackbox-cli`               | The `blackbox` command; install explicitly for command-line use |
| `@suites/blackbox-capsule`           | Interactive execution, observations, and Capsule reports        |
| `@suites/blackbox-playwright`        | Native Playwright system-test fixtures                          |
| `@suites/blackbox-inst-runtime-node` | Node instrumentation installation                               |
| `@suites/blackbox-driver`            | Project-owned driver runtime and SDK                            |

The main package depends on CLI, Skills, Catalog, and Discovery, but has no `bin`
or launcher. Install CLI directly rather than relying on a package manager to
expose a transitive dependency's executable.

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
blackbox() { node "$blackbox_checkout/packages/cli/bin/run.js" "$@"; }
blackbox --help
```

You should see the CLI help, including `capsule`, `catalog`, and `skills`.
The source checkout deliberately selects all of its declared workspace providers.
That is broader than a consumer installing just `@suites/blackbox` and `@suites/blackbox-cli`.
Blackbox uses the current directory as the project root: it reads
`blackbox.config.yaml` there and retains experiment data under `.blackbox/`.

The shortcut uses an absolute path to your build, so you can change into another project directory and run `blackbox` there.
It is defined only for this terminal session. In a new terminal, return to the checkout and define it again.

Continue with [your first Capsule](getting-started.md) or [configure an application](configuration.md).

## Install the SDK for project drivers

Skip this section if you only use host commands without `--via`. To use or author
project drivers, install their SDK alongside the project's driver modules. The
guided demo handles this step automatically for its own run.

For a source installation, first package the SDK and its two Blackbox dependencies
from your completed build. Pack them into a directory outside the checkout and keep
it: the project's driver package refers to these files on every later install.

```sh
blackbox_packages="${XDG_CACHE_HOME:-$HOME/.cache}/blackbox/packages"
mkdir -p "$blackbox_packages"
for package in telemetry cli-contract driver; do
  pnpm --config.ignore-scripts=true --dir "$blackbox_checkout/packages/$package" \
    pack --pack-destination "$blackbox_packages"
done
```

For the included application, enter its project directory:

```sh
cd "$blackbox_checkout/e2e"
```

For your own application, use its project directory instead. Then install the three local packages and prepare the runtime:

```sh
npm install --prefix .blackbox/drivers --ignore-scripts --no-audit --no-fund \
  "$blackbox_packages/suites-blackbox-telemetry-0.0.1-alpha.0.tgz" \
  "$blackbox_packages/suites-blackbox-cli-contract-0.0.1-alpha.0.tgz" \
  "$blackbox_packages/suites-blackbox-driver-0.0.1-alpha.0.tgz"
blackbox driver install --runtime node --json
```

The filenames above match the first alpha. Use the filenames printed by `pack` if
your checkout has a different version. Because the SDK's Blackbox dependencies are
installed as direct dependencies, npm resolves them to the local files on later
installs too, so no `overrides` entry is needed. If an older guide had you add one,
npm releases before 9.3.0 fail on it with `Invalid comparator: file:…`;
`driver install` then names the minimum npm version. Remove the `overrides` entry
from `.blackbox/drivers/package.json` or upgrade npm (Node.js 22 ships npm 10).

For the included application, the project directory is `$blackbox_checkout/e2e`; its driver modules are already
provided. Continue with the [subscription investigation](experiments.md).

## Install the Playwright package from source

Until the alpha is published, a Playwright project installs `@suites/blackbox-playwright`
and the eight Blackbox packages it depends on from tarballs packed from your completed
build. Pack them into the same directory as the driver SDK:

```sh
blackbox_packages="${XDG_CACHE_HOME:-$HOME/.cache}/blackbox/packages"
mkdir -p "$blackbox_packages"
for package in telemetry cli-contract skills catalog instrumentation \
  instrumentation-runtime-node otel-collector sandbox playwright; do
  pnpm --config.ignore-scripts=true --dir "$blackbox_checkout/packages/$package" \
    pack --pack-destination "$blackbox_packages"
done
```

Then, from your Playwright project's directory, install Playwright Test and all nine
tarballs in one command, so npm resolves every Blackbox dependency to its local file
instead of the registry:

```sh
cd path/to/your-playwright-project
npm install --save-dev --no-audit --no-fund '@playwright/test@^1.61.0' \
  "$blackbox_packages"/suites-blackbox-{telemetry,cli-contract,skills,catalog}-0.0.1-alpha.0.tgz \
  "$blackbox_packages"/suites-blackbox-{instrumentation,inst-runtime-node,otel-collector}-0.0.1-alpha.0.tgz \
  "$blackbox_packages"/suites-blackbox-{sandbox,playwright}-0.0.1-alpha.0.tgz
```

Keep the packed files: the project's `package.json` refers to them. Write the tests as
shown in the [Playwright package](../packages/playwright/README.md); the project also
needs a `blackbox.config.yaml` catalog, as described in [configuration](configuration.md).
