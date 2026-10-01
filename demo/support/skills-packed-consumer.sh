#!/usr/bin/env bash

# Packed-consumer check for `blackbox skills install`. Packs the CLI, its
# contract, generic skills plugin and Discovery, installs only those tarballs into a clean
# project outside the workspace, and drives the installed CLI there: a fresh
# install, an unchanged rerun, the `skill install` alias, a preserved conflict,
# and adoption of a matching manual copy. Needs no Docker and no network beyond
# what `pnpm install --prefer-offline` may fetch for @oclif/core.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
PACKAGES=(cli-contract cli skills discovery)

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
cd "$PROJECT"
PACKED_SKILL="$(node --input-type=module -e 'import { discoverySkill } from "@suites/blackbox-discovery/skills/discovery"; import { fileURLToPath } from "node:url"; console.log(fileURLToPath(discoverySkill.source));')"
PACKED_VERSION="$(node --input-type=module -e 'import { skillModule } from "@suites/blackbox-discovery/skills"; import { readFileSync } from "node:fs"; console.log(JSON.parse(readFileSync(new URL("package.json", skillModule.packageRoot), "utf8")).version);')"
[[ -f "$PACKED_SKILL/SKILL.md" ]] || fail "the Discovery public export has no SKILL.md"
case "$PACKED_SKILL" in
  "$REPO_ROOT"/*) fail "the packed skill resolved through the workspace" ;;
esac

cd "$PROJECT"
"$BLACKBOX" skills list --json >"$WORK_ROOT/list.json"
jq -e '[.skills[].name] == ["discovery"] and ([.skills[].integrations[].available] == [false, false])' "$WORK_ROOT/list.json" >/dev/null ||
  fail "absent packages contributed skills: $(cat "$WORK_ROOT/list.json")"
node --input-type=module -e 'import { readFileSync } from "node:fs"; import { discoverySkill } from "@suites/blackbox-discovery/skills/discovery"; import { validateAudit } from "@suites/blackbox-discovery"; const read = (name) => JSON.parse(readFileSync(new URL(`examples/http/${name}.json`, discoverySkill.source), "utf8")); if (validateAudit(read("audit"), read("receipts")).kind !== "accepted") throw new Error("packed audit validation failed");'
"$BLACKBOX" skills install discovery --codex --claude --gitignore --json >"$WORK_ROOT/first.json"
jq -e '.ok and ([.destinations[].outcome] == ["installed", "installed"])' "$WORK_ROOT/first.json" >/dev/null ||
  fail "fresh install: $(cat "$WORK_ROOT/first.json")"
for destination in .agents/skills/discovery .claude/skills/discovery; do
  diff -r -x .blackbox-install.json "$PACKED_SKILL" "$destination" >/dev/null ||
    fail "$destination differs from the packed skill"
  jq -e --arg version "$PACKED_VERSION" \
    '.installer == "@suites/blackbox-skills" and .sourcePackage == "@suites/blackbox-discovery" and .version == $version' \
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

# The module remains on disk but removing it from the selected project plugins
# must remove its contribution, even when an old agent copy remains installed.
jq 'del(.dependencies["@suites/blackbox-discovery"])' package.json >package.json.next
mv package.json.next package.json
"$BLACKBOX" skills list --json >"$WORK_ROOT/unselected.json"
jq -e '.skills == []' "$WORK_ROOT/unselected.json" >/dev/null || fail "unselected Discovery remained registered"
status=0
"$BLACKBOX" skills install discovery --codex >"$WORK_ROOT/unavailable.out" 2>&1 || status=$?
[[ "$status" -eq 2 ]] || fail "unselected Discovery exited $status, expected 2"
grep -q 'Skill is unavailable' "$WORK_ROOT/unavailable.out" || fail "missing skill was not explained"

echo "skills-packed-consumer: passed (public exports, packed helpers, absent integrations, installed, unchanged, alias, conflict preserved, adopted, unselected provider)"
