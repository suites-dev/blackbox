# Install or refresh a package skill

Skills are copied into the project, not loaded dynamically from npm by the agent.
The generic Skills installer obtains their content through package contributions.
The CLI package owns `blackbox`; each optional feature package owns its own skill.

First distinguish the missing layer:

- No installed CLI: the project needs `@suites/blackbox-cli`.
- No `skills` command: select `@suites/blackbox-skills` in the project's dependencies.
- No named contribution in `blackbox skills list --json`: its provider is not
  available in the selected plugin set. Check the project's declared and installed
  dependencies. A transitive package or an old agent copy is not sufficient.
- Contribution listed but host skill unavailable: it needs a project-local copy
  for that host, or the host needs to rediscover an existing copy.

Adding a package and copying a skill are separate changes. Obtain authorization
for the needed changes, preserve the project's package-manager choice, and use
compatible package versions. Do not fetch a provider just because a route names it.

## Copy for the selected host

Run the project's installed CLI from the project directory. For example:

```sh
blackbox skills install blackbox --codex --gitignore
blackbox skills install discovery --codex --gitignore
```

The second command is only appropriate if Discovery is contributed and the user
wants that skill. Installing `blackbox` alone does not copy optional integrations.

| Flag       | Project-local destination |
| ---------- | ------------------------- |
| `--codex`  | `.agents/skills/<name>/`  |
| `--cursor` | `.agents/skills/<name>/`  |
| `--claude` | `.claude/skills/<name>/`  |

Choose only the requested host flags. Codex and Cursor share one physical copy.
`--gitignore` is optional: it adds entries for successful skill destinations, not
the entire `.blackbox/` state directory or every agent skill. Omit it when the user
wants to track the copies. The installer does not start or refresh an agent.

## Versions and local edits

Each copied skill has `.blackbox-install.json` recording its source package,
version, and file hashes. These are ownership/update records, not evidence that
the provider is still selected or that the agent has loaded the copy.

After an authorized package update, rerun the same install command. Identical
copies remain unchanged; installer-owned, unmodified copies can be updated.
Locally edited or conflicting copies are preserved and reported. Inspect a
conflict with the user before moving or removing anything; do not bypass it by
overwriting the directory or editing the ownership record.

Check the command outcome and copied `SKILL.md`. If the host has not discovered it,
ask the user to refresh or restart that host as appropriate. A successful copy is
not proof that `$blackbox` or another skill is available in the current session.
