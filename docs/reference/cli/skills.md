# Skills commands

## List available instructions

```sh
blackbox skills list --json
```

The list reflects the installed and selected CLI composition. Base Blackbox supplies `blackbox`, `catalog`, and `discovery`; Capsule contributes its own skill only when selected.

## Install a skill

```sh
blackbox skills install blackbox --codex --gitignore
blackbox skills install discovery --codex
blackbox skills install catalog --codex
blackbox skills install capsule --codex
```

The last command requires Capsule support to be installed and selected. Replace `--codex` with `--cursor` or `--claude` for the intended host. Codex/Cursor use `.agents/skills/`; Claude uses `.claude/skills/`.

`--gitignore` adds only successfully installed destinations. The command copies the skill and relative references; it does not download the contributing package or install every specialist automatically.

## Repeat installation

Rerun after a package upgrade to update unmodified copies. Local edits are conflicts to review, not an instruction to overwrite. Skill installation and host discovery are separate; refresh the agent using its supported procedure if newly copied instructions are not visible.

Use installed command help for additional options. A skill label in an illustration does not establish an installable skill ID.

Next: [Skills guide](../../agents/skills.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/blackbox/README.md).

---

[Documentation](../../README.md)
