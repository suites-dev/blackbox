#!/usr/bin/env bash

# Screen-recording entrypoint. The storyboard remains YAML while Ruby's
# standard-library YAML parser handles it without adding a project dependency.
set -Eeuo pipefail
STORYBOARD_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The support script sets its own SCRIPT_DIR, which now names a different
# directory, so the storyboard keeps its path under a name support does not use.
source "$STORYBOARD_DIR/../acceptance/capsule-test-support.sh"
ruby "$STORYBOARD_DIR/capsule-player.rb" "$@"
