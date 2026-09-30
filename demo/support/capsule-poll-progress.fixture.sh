#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INTERACTIVE=0
C_CYAN=''
C_RESET=''
source "$SCRIPT_DIR/capsule-poll-progress.sh"
render_poll_progress 3 15 'waiting for separate consumer -> public-api trace'
