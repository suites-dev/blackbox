#!/usr/bin/env bash

render_poll_progress() {
  local elapsed_seconds="$1"
  local timeout_seconds="$2"
  local condition="$3"
  if [[ "$INTERACTIVE" -eq 1 ]]; then
    printf '\r%s[blackbox]%s Shared-state proof: %s · %ss / %ss\033[K' \
      "$C_CYAN" "$C_RESET" "$condition" "$elapsed_seconds" "$timeout_seconds"
  else
    printf '%s[blackbox]%s Shared-state proof: %s · %ss / %ss\n' \
      "$C_CYAN" "$C_RESET" "$condition" "$elapsed_seconds" "$timeout_seconds"
  fi
}

finish_poll_progress() {
  if [[ "$INTERACTIVE" -eq 1 ]]; then
    printf '\r\033[K'
  fi
}
