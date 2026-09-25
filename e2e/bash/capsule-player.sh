#!/usr/bin/env bash

# Screen-recording entrypoint. The storyboard remains YAML while Ruby's
# standard-library YAML parser handles it without adding a project dependency.
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/capsule-test-support.sh"
ruby "$SCRIPT_DIR/capsule-player.rb" "$@"
