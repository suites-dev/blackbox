# Install Blackbox

Build the Blackbox CLI from source, then use it from the directory of the application you want to investigate.

> **Alpha distribution:** Blackbox has not been published to npm. The source installation below is the available
> installation method. The repository's default branch is `release/v0.0.1-alpha`.

## Prerequisites

- Git, Node.js 22.15 or newer in the Node 22 line, and pnpm 9.15.4.
- Docker with Compose for running Capsule environments.
- Bash or Zsh, plus `jq` and `curl` for the tutorials.
- Network access to download dependencies and container images.

Start Docker and check that `docker info` succeeds before running a Capsule.
The first application startup may take several minutes while images download and build.

## Build the CLI

```sh
git clone https://github.com/suites-dev/blackbox.git
cd blackbox
pnpm install --frozen-lockfile
pnpm build
```

Use the same branch as the documentation you are following.

## Make the CLI available in your terminal

From the Blackbox checkout, define a shell shortcut:

```sh
blackbox_checkout="$PWD"
blackbox() { node "$blackbox_checkout/packages/cli/bin/run.js" "$@"; }
blackbox --help
```

You should see the CLI help, including `capsule`, `catalog`, and `observations`.
The shortcut uses an absolute path to your build, so you can change into another project directory and run `blackbox` there.
It is defined only for this terminal session. In a new terminal, return to the checkout and define it again.

Blackbox uses the current directory as the project root: it reads `blackbox.config.yaml` there and retains
experiment data under `.blackbox/`.

Continue with [your first Capsule](getting-started.md) or [configure an application](configuration.md).

## Install the SDK for project drivers

Skip this section if you only use host commands without `--driver`. To use or author project drivers, install their
SDK alongside the project's driver modules. The guided demo handles this step automatically for its own run.

For a source installation, first package the SDK and its telemetry dependency from your completed build:

```sh
mkdir -p "$blackbox_checkout/.blackbox/driver-packages"
pnpm --config.ignore-scripts=true --dir "$blackbox_checkout/packages/telemetry" \
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
  "$blackbox_checkout/.blackbox/driver-packages/suites-blackbox-telemetry-internal-0.0.0.tgz" \
  "$blackbox_checkout/.blackbox/driver-packages/suites-blackbox-driver-0.0.0.tgz"
npm pkg set --prefix .blackbox/drivers \
  'overrides.@suites/blackbox-telemetry-internal=$@suites/blackbox-telemetry-internal'
blackbox driver install --runtime node --json
```

The filenames above match the source package version `0.0.0`. Use the filenames printed by `pack` if your checkout
has a different version. Keep the tarballs available for subsequent dependency installs.
The override keeps the SDK's telemetry dependency pointed at the local package during later installs.

For the included application, the project directory is `$blackbox_checkout/e2e`; its driver modules are already
provided. Continue with the [subscription investigation](experiments.md).
