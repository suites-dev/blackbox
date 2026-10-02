#!/usr/bin/env bash

# Packed-consumer check for `blackbox skills install`. Packs the main package and
# its core dependencies, installs only @suites/blackbox directly into a clean
# project outside the workspace, and drives the installed main executable there: a fresh
# Blackbox entry skill, an unchanged rerun, the `skill install` alias, a preserved conflict,
# and adoption of a matching manual copy. Needs no Docker and no network beyond
# what `pnpm install --prefer-offline` may fetch for @oclif/core.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
PACKAGES=(cli-contract telemetry skills cli catalog discovery blackbox)

for command in pnpm jq node diff; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "skills-packed-consumer: required command is unavailable: $command" >&2
    exit 1
  }
done

PNPM_STORE_DIR="$(sed -n 's/^storeDir: //p' "$REPO_ROOT/node_modules/.modules.yaml")"
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/blackbox-skills-consumer.XXXXXX")"
WORK_ROOT="$(cd -- "$WORK_ROOT" && pwd -P)"
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

jq '{name: "skills-packed-consumer", private: true, type: "module",
  packageManager: .packageManager, dependencies: {}, pnpm: {overrides: {}}}' \
  "$REPO_ROOT/package.json" >"$PROJECT/package.json"
for package in "${PACKAGES[@]}"; do
  directory="$REPO_ROOT/packages/$package"
  name="$(jq -er '.name' "$directory/package.json")"
  pnpm --config.ignore-scripts=true --dir "$directory" pack --pack-destination "$PACK_ROOT" >/dev/null
  archive="$PACK_ROOT/$(echo "${name#@}" | tr / -)-$(jq -er '.version' "$directory/package.json").tgz"
  [[ -s "$archive" ]] || fail "pack did not produce $archive"
  jq --arg name "$name" --arg archive "file:$archive" \
    '.pnpm.overrides[$name] = $archive | if $name == "@suites/blackbox" then .dependencies[$name] = $archive else . end' \
    "$PROJECT/package.json" >"$PROJECT/package.json.next"
  mv "$PROJECT/package.json.next" "$PROJECT/package.json"
done

pnpm --dir "$PROJECT" install --ignore-workspace --prefer-offline --ignore-scripts \
  ${PNPM_STORE_DIR:+--store-dir "$PNPM_STORE_DIR"} >/dev/null
BLACKBOX="$PROJECT/node_modules/.bin/blackbox"
cd "$PROJECT"
PACKED_BLACKBOX="$(node --input-type=module -e 'import { blackboxSkill } from "@suites/blackbox/skills/blackbox"; import { fileURLToPath } from "node:url"; console.log(fileURLToPath(blackboxSkill.source));')"
BLACKBOX_VERSION="$(node --input-type=module -e 'import { skillModule } from "@suites/blackbox/skills"; import { readFileSync } from "node:fs"; console.log(JSON.parse(readFileSync(new URL("package.json", skillModule.packageRoot), "utf8")).version);')"
MAIN_ROOT="$(node --input-type=module -e 'import { skillModule } from "@suites/blackbox/skills"; import { fileURLToPath } from "node:url"; console.log(fileURLToPath(skillModule.packageRoot));')"
# pnpm emits a launcher shim; it must dispatch to the main package's executable.
grep -F '/@suites/blackbox/bin/run.js' "$BLACKBOX" >/dev/null || fail "launcher does not belong to the main package"
# Resolve core providers from their declaring package, without dependency hoisting.
cd "$MAIN_ROOT"
PACKED_SKILL="$(node --input-type=module -e 'import { discoverySkill } from "@suites/blackbox-discovery/skills/discovery"; import { fileURLToPath } from "node:url"; console.log(fileURLToPath(discoverySkill.source));')"
PACKED_VERSION="$(node --input-type=module -e 'import { skillModule } from "@suites/blackbox-discovery/skills"; import { readFileSync } from "node:fs"; console.log(JSON.parse(readFileSync(new URL("package.json", skillModule.packageRoot), "utf8")).version);')"
[[ -f "$PACKED_SKILL/SKILL.md" ]] || fail "the Discovery public export has no SKILL.md"
[[ -f "$PACKED_BLACKBOX/SKILL.md" ]] || fail "the Blackbox public export has no SKILL.md"
[[ -f "$PACKED_BLACKBOX/references/skill-installation.md" ]] || fail "the Blackbox installation reference was not packed"
case "$PACKED_SKILL" in
  "$REPO_ROOT"/*) fail "the packed skill resolved through the workspace" ;;
esac
case "$PACKED_BLACKBOX" in
  "$PROJECT"/node_modules/*) ;;
  *) fail "the Blackbox public export did not resolve inside the consumer" ;;
esac

cd "$PROJECT"
NODE_ENV=production "$BLACKBOX" skills list --json >"$WORK_ROOT/list.json"
jq -e '.skills == [
  {name: "blackbox", dependencies: [], integrations: [
    {name: "discovery", available: true}, {name: "catalog", available: true}, {name: "capsule", available: false}
  ]},
  {name: "catalog", dependencies: [], integrations: []},
  {name: "discovery", dependencies: [], integrations: [
    {name: "catalog", available: true}, {name: "capsule", available: false}
  ]}
]' "$WORK_ROOT/list.json" >/dev/null ||
  fail "absent packages contributed skills: $(cat "$WORK_ROOT/list.json")"

"$BLACKBOX" skills install blackbox --codex --cursor --claude --gitignore --json >"$WORK_ROOT/blackbox.json"
jq -e --arg version "$BLACKBOX_VERSION" '.ok and
  .source == {package: "@suites/blackbox", version: $version} and
  ([.destinations[].outcome] == ["installed", "installed"]) and
  ([.results[].agent] == ["codex", "cursor", "claude"])' "$WORK_ROOT/blackbox.json" >/dev/null ||
  fail "entry skill install: $(cat "$WORK_ROOT/blackbox.json")"
for destination in .agents/skills/blackbox .claude/skills/blackbox; do
  diff -r -x .blackbox-install.json "$PACKED_BLACKBOX" "$destination" >/dev/null ||
    fail "$destination differs from the packed entry skill"
  jq -e --arg version "$BLACKBOX_VERSION" \
    '.installer == "@suites/blackbox-skills" and .sourcePackage == "@suites/blackbox" and .version == $version' \
    "$destination/.blackbox-install.json" >/dev/null || fail "$destination has a wrong record"
  grep -Fxq "/$destination/" .gitignore || fail "$destination was not ignored"
done
for integration in discovery catalog capsule; do
  [[ ! -e ".agents/skills/$integration" && ! -e ".claude/skills/$integration" ]] ||
    fail "Blackbox silently installed optional skill $integration"
done
"$BLACKBOX" skills install blackbox --codex --cursor --claude --gitignore --json >"$WORK_ROOT/blackbox-repeat.json"
jq -e '.ok and ([.destinations[].outcome] == ["unchanged", "unchanged"]) and .gitignore.outcome == "unchanged"' \
  "$WORK_ROOT/blackbox-repeat.json" >/dev/null || fail "entry skill rerun changed the copy"

(cd "$MAIN_ROOT" && node --input-type=module -e 'import { readFileSync } from "node:fs"; import { discoverySkill } from "@suites/blackbox-discovery/skills/discovery"; import { validateAudit } from "@suites/blackbox-discovery"; const read = (name) => JSON.parse(readFileSync(new URL(`examples/http/${name}.json`, discoverySkill.source), "utf8")); if (validateAudit(read("audit"), read("receipts")).kind !== "accepted") throw new Error("packed audit validation failed");')
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

# Installing the main package alone must not pull execution adapters or Docker.
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { createRequire } from "node:module";
  const fromMain = createRequire(import.meta.resolve("@suites/blackbox"));
  for (const name of ["@suites/blackbox-capsule", "@suites/blackbox-playwright", "@suites/blackbox-inst-runtime-node", "@suites/blackbox-sandbox"]) {
    assert.throws(() => fromMain.resolve(name), {code: "MODULE_NOT_FOUND"});
  }
'
"$BLACKBOX" --help >"$WORK_ROOT/core-help.txt"
grep -F 'skills install' "$WORK_ROOT/core-help.txt" >/dev/null || fail "core skills command missing"
grep -F 'catalog validate' "$WORK_ROOT/core-help.txt" >/dev/null || fail "core catalog command missing"
if grep -F 'capsule up' "$WORK_ROOT/core-help.txt"; then fail "absent Capsule exposed commands"; fi

# Removing the main bundle from a custom composition removes its contributions,
# even when old copies remain. Only explicitly selected low-level modules remain.
jq '.dependencies = {"@suites/blackbox-cli": .pnpm.overrides["@suites/blackbox-cli"], "@suites/blackbox-skills": .pnpm.overrides["@suites/blackbox-skills"]}' package.json >package.json.next
mv package.json.next package.json
pnpm install --ignore-workspace --prefer-offline --ignore-scripts \
  ${PNPM_STORE_DIR:+--store-dir "$PNPM_STORE_DIR"} >/dev/null
"$BLACKBOX" skills list --json >"$WORK_ROOT/unselected.json"
jq -e '.skills == []' "$WORK_ROOT/unselected.json" >/dev/null || fail "unselected core modules remained registered"
status=0
"$BLACKBOX" skills install discovery --codex >"$WORK_ROOT/unavailable.out" 2>&1 || status=$?
[[ "$status" -eq 2 ]] || fail "unselected Discovery exited $status, expected 2"
grep -q 'Skill is unavailable' "$WORK_ROOT/unavailable.out" || fail "missing skill was not explained"

# The generic CLI must remain usable without the product package or Skills.
CLI_ONLY="$WORK_ROOT/cli-only"
mkdir "$CLI_ONLY"
jq 'del(.dependencies["@suites/blackbox-skills"])' "$PROJECT/package.json" >"$CLI_ONLY/package.json"
pnpm --dir "$CLI_ONLY" install --ignore-workspace --prefer-offline --ignore-scripts \
  ${PNPM_STORE_DIR:+--store-dir "$PNPM_STORE_DIR"}
cd "$CLI_ONLY"
node_modules/.bin/blackbox --help >"$WORK_ROOT/cli-only-help.txt"
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { createRequire } from "node:module";
  import { runCli } from "@suites/blackbox-cli/run";
  assert.equal(typeof runCli, "function");
  const fromCli = createRequire(import.meta.resolve("@suites/blackbox-cli/run"));
  assert.throws(() => fromCli.resolve("@suites/blackbox-skills"), {code: "MODULE_NOT_FOUND"});
  assert.throws(() => fromCli.resolve("@suites/blackbox"), {code: "MODULE_NOT_FOUND"});
'

echo "skills-packed-consumer: passed (main package only, all hosts, public exports, packed helpers, absent adapters, installed, unchanged, alias, conflict preserved, adopted, unselected bundle, standalone CLI)"
