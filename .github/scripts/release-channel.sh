#!/usr/bin/env bash
set -euo pipefail

version="${1:?release version is required}"

if [[ "$version" =~ -alpha([.]|$) ]]; then
  printf 'alpha true\n'
elif [[ "$version" == *-* ]]; then
  printf 'next true\n'
else
  printf 'latest false\n'
fi
