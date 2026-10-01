#!/usr/bin/env bash

# Packed-consumer check for `blackbox skills install`. Packs the CLI, its
# contract and the skills plugin, installs only those tarballs into a clean
# project outside the workspace, and drives the installed CLI there: a fresh
# install, an unchanged rerun, the `skill install` alias, a preserved conflict,
# and adoption of a matching manual copy. Needs no Docker and no network beyond
# what `pnpm install --prefer-offline` may fetch for @oclif/core.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
PACKAGES=(cli-contract cli skills)

for command in pnpm jq node diff; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "skills-packed-consumer: required command is unavailable: $command" >&2
    exit 1
  }
done

PNPM_STORE_DIR="$(sed -n 's/^storeDir: //p' "$REPO_ROOT/node_modules/.modules.yaml")"
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/blackbox-skills-consumer.XXXXXX")"
trap 'rm -rf "$WORK_ROOT"' EXIT
PACK_ROOT="$WORK_ROOT/tarballs"
PROJECT="$WORK_ROOT/project"
mkdir -p "$PACK_ROOT" "$PROJECT"

fail() {
  echo "skills-packed-consumer: $*" >&2
  exit 1
}

cd "$REPO_ROOT"
for package in "${PACKAGES[@]}"; do
  pnpm --dir "packages/$package" run build >/dev/null
done

printf '{"name":"skills-packed-consumer","private":true,"type":"module","dependencies":{},"pnpm":{"overrides":{}}}\n' \
  >"$PROJECT/package.json"
for package in "${PACKAGES[@]}"; do
  directory="$REPO_ROOT/packages/$package"
  name="$(jq -er '.name' "$directory/package.json")"
  pnpm --config.ignore-scripts=true --dir "$directory" pack --pack-destination "$PACK_ROOT" >/dev/null
  archive="$PACK_ROOT/$(echo "${name#@}" | tr / -)-$(jq -er '.version' "$directory/package.json").tgz"
  [[ -s "$archive" ]] || fail "pack did not produce $archive"
  jq --arg name "$name" --arg archive "file:$archive" \
    '.dependencies[$name] = $archive | .pnpm.overrides[$name] = $archive' \
    "$PROJECT/package.json" >"$PROJECT/package.json.next"
  mv "$PROJECT/package.json.next" "$PROJECT/package.json"
done

pnpm --dir "$PROJECT" install --ignore-workspace --prefer-offline --ignore-scripts \
  ${PNPM_STORE_DIR:+--store-dir "$PNPM_STORE_DIR"} >/dev/null
BLACKBOX="$PROJECT/node_modules/.bin/blackbox"
PACKED_SKILL="$(cd "$PROJECT/node_modules/@suites/blackbox-skills/assets/discovery" && pwd -P)"
[[ -f "$PACKED_SKILL/SKILL.md" ]] || fail "the packed skills package has no assets/discovery/SKILL.md"
case "$PACKED_SKILL" in
  "$REPO_ROOT"/*) fail "the packed skill resolved through the workspace" ;;
esac

cd "$PROJECT"
"$BLACKBOX" skills install discovery --codex --claude --json >"$WORK_ROOT/first.json"
jq -e '.ok and ([.destinations[].outcome] == ["installed", "installed"])' "$WORK_ROOT/first.json" >/dev/null ||
  fail "fresh install: $(cat "$WORK_ROOT/first.json")"
for destination in .agents/skills/discovery .claude/skills/discovery; do
  diff -r -x .blackbox-install.json "$PACKED_SKILL" "$destination" >/dev/null ||
    fail "$destination differs from the packed skill"
  jq -e --arg version "$(jq -r .version "$PACKED_SKILL/../../package.json")" \
    '.installer == "@suites/blackbox-skills" and .version == $version' \
    "$destination/.blackbox-install.json" >/dev/null || fail "$destination has a wrong record"
done

"$BLACKBOX" skills install discovery --codex --claude --json >"$WORK_ROOT/repeat.json"
jq -e '.ok and ([.destinations[].outcome] == ["unchanged", "unchanged"])' "$WORK_ROOT/repeat.json" >/dev/null ||
  fail "unchanged rerun: $(cat "$WORK_ROOT/repeat.json")"
"$BLACKBOX" skill install discovery --cursor --json >"$WORK_ROOT/alias.json"
jq -e '[.results[] | [.agent, .kind]] == [["cursor", "unchanged"]]' "$WORK_ROOT/alias.json" >/dev/null ||
  fail "skill install alias: $(cat "$WORK_ROOT/alias.json")"

echo '# team notes' >>.claude/skills/discovery/SKILL.md
status=0
"$BLACKBOX" skills install discovery --claude >"$WORK_ROOT/conflict.out" 2>&1 || status=$?
[[ "$status" -eq 1 ]] || fail "conflict exited $status, expected 1"
grep -q 'claude: conflict' "$WORK_ROOT/conflict.out" || fail "conflict not reported: $(cat "$WORK_ROOT/conflict.out")"
grep -q 'move or remove it, then rerun' "$WORK_ROOT/conflict.out" || fail "conflict has no remedy"
[[ "$(tail -n 1 .claude/skills/discovery/SKILL.md)" == '# team notes' ]] || fail "the local edit was overwritten"

rm -rf .claude/skills/discovery
cp -R "$PACKED_SKILL" .claude/skills/discovery
"$BLACKBOX" skills install discovery --claude --json >"$WORK_ROOT/adopt.json"
jq -e '.ok and ([.destinations[].outcome] == ["adopted"])' "$WORK_ROOT/adopt.json" >/dev/null ||
  fail "adoption: $(cat "$WORK_ROOT/adopt.json")"

echo "skills-packed-consumer: passed (installed, unchanged, alias, conflict preserved, adopted)"
