# 12 — List `deploylog` on CLI-Hub (`HKUDS/CLI-Anything`, `public_registry.json`)

**Status:** step 1 in review 2026-09-29 (branch `feat/agent-skill`: the skill re-checked against `src/` that day, 39 of 39 cited commands and flags present with a planted fake flag missing, frontmatter parsed by `yaml` with a malformed control rejected); steps 2-3, the upstream registry PR, not filed · **Type:** HUMAN (Marko merges the skill here, then opens the upstream PR from his account) · **Lane:** deploylog-cli
**Parent:** monolith re-mine of `HKUDS/CLI-Anything`, 2026-09-29 (knowledge: `source-cli-anything`). Lands **item 1 of issue 07 early** (the canonical skill body); 07's items 2-5 (`files`, `init` writing it, `deploylog skill`, the npm-pack test) stay queued.
**Changed 2026-09-29 (Marko's call, DeployLog issue 150):** the skill's login bullet now says the
person runs `deploylog login` in their own terminal and the agent never handles the key, with one
CI exception (`deploylog login --key "$DEPLOYLOG_API_KEY"` from a repository secret). It used to
say "an agent always passes it", which put the key in the agent's transcript and contradicted
`https://deploylog.dev/install/agent.md`. No command or flag changed.
**Blocked by:** nothing. Order matters: the skill must be on `main` here before the upstream PR opens, because the registry entry links to it.
**Verification:** after the skill merges, `curl -sfI https://raw.githubusercontent.com/marko-builds/deploylog-cli/main/skills/deploylog/SKILL.md` answers 200, and the frontmatter parses under a real YAML parser (07's `description: >-` rule). After the upstream merge, `pip install cli-anything-hub && cli-hub info deploylog` shows the entry, and `cli-hub install deploylog` runs `npm install -g deploylog` (its npm path, `cli_hub/installer.py` `_npm_install`). Known negative: `cli-hub info deploylog-nonexistent` must report not found, so an `info` that prints anything is not evidence on its own.

## Why

CLI-Hub is CLI-Anything's registry and package manager (51k stars). Its `cli-hub-meta-skill` is how agents in Claude Code, Codex and others find a CLI for a task. `public_registry.json` lists third-party CLIs, and paid products are accepted: 24 entries as of 2026-09-29, 11 of them npm, including Sentry, DeployHQ, Shopify, and Vivideo (merged 2026-08-21 as #425, a single-file PR). `deploylog` is not in it, or in `registry.json`.

The CLI already meets the bar: on npm (`deploylog@0.7.0`, bin `deploylog` + `dpl`), public MIT repo, `--json` on every data command, prompt-free errors, 197 tests passing (run 2026-09-29).

Reality tag: about an hour of Marko's time (merge here, fork, open the PR). The reach is unmeasured. It is a GitHub listing and an agent-discovery path, not a dofollow directory. Merge latency is likely weeks: maintainers merge in batches (2026-08-03, 2026-08-21), and four registry PRs opened 2026-09-14 to 2026-09-26 were still open on 2026-09-29.

## Order of operations

1. **Here:** review `skills/deploylog/SKILL.md` (drafted 2026-09-29; every command and flag in it checked against `src/index.ts` that day), commit it on a `feat/` branch, PR, merge. It does not touch a file the Manual cites, so `manual-check.yml` has nothing new to annotate.
2. **Upstream:** fork `HKUDS/CLI-Anything`, branch `feat/add-deploylog-public-registry`, append the entry below to the `clis` array in `public_registry.json`, run `python -m json.tool public_registry.json > /dev/null`, commit `feat(registry): add DeployLog CLI to public registry`.
3. Open the PR against `main` with the body below.
4. Record the PR number here and flip `Status:`.

## The registry entry

`homepage` is DeployLog's site (the field is the target software's homepage). `description` reuses only lines that already exist in `projects/deploylog/BRAND.md` Messaging (the PH descriptor) and the npm description, per that file's "don't invent a new line" rule. The CLI claims after them are facts from `src/index.ts`.

```json
{
  "name": "deploylog",
  "display_name": "DeployLog CLI",
  "version": "0.7.0",
  "description": "Turn git commits into public changelogs. Push changelog entries from the terminal, publish drafts, and check a DeployLog Manual against the code it cites. Every data command takes --json.",
  "category": "devops",
  "requires": "Node.js 18+; a DeployLog account and API key (free plan available)",
  "homepage": "https://deploylog.dev",
  "source_url": "https://github.com/marko-builds/deploylog-cli",
  "package_manager": "npm",
  "npm_package": "deploylog",
  "install_cmd": "npm install -g deploylog",
  "npx_cmd": "npx deploylog",
  "skill_md": "https://github.com/marko-builds/deploylog-cli/blob/main/skills/deploylog/SKILL.md",
  "entry_point": "deploylog",
  "contributors": [
    {
      "name": "marko-builds",
      "url": "https://github.com/marko-builds"
    }
  ]
}
```

## The PR body (Marko's voice, draft)

Title: `feat(registry): add DeployLog CLI to public registry`

```markdown
## Description

Adds the DeployLog CLI (`deploylog` on npm) to `public_registry.json`, next to the other npm CLIs.

DeployLog turns git commits into public changelogs. The CLI drafts an entry from the commits since the last tag (or from flags) and publishes it when you are ready. It also checks a project's Manual (product docs whose claims cite files in the repo) against the code at a given commit, so it can run as a CI step or a pre-push hook.

I built it to be driven by scripts and agents:

- `--json` on every data command: data on stdout, errors on stderr as `{"error":{"code","message"}}`
- no prompts in `--json` mode, and `delete` refuses without `--yes`
- entries are drafts by default; publishing takes an explicit `--publish` or `deploylog publish <id>`
- `manual verify` exits 0 / 1 / 2 (clean / drift / could not verify)

## Type of Change

- [x] **Other**: registry-only entry in `public_registry.json` for an npm CLI (same shape as #425)

## Registry entry

- **Package:** [`deploylog`](https://www.npmjs.com/package/deploylog), v0.7.0
- **Install:** `npm install -g deploylog` or `npx deploylog`
- **Entry point:** `deploylog` (alias `dpl`)
- **Requires:** Node.js 18+, a DeployLog account and API key (free plan available)
- **Category:** `devops`
- **Source:** https://github.com/marko-builds/deploylog-cli (MIT)
- **SKILL.md:** https://github.com/marko-builds/deploylog-cli/blob/main/skills/deploylog/SKILL.md

## Checks

- [ ] JSON validated locally; entry appended to the `clis` array
- [ ] `npm install -g deploylog` installs the `deploylog` binary
- [x] The repo has its own test suite (197 tests, Vitest)
- [x] SKILL.md lists only commands and flags that exist in the CLI

Happy to change the category if another fits better, or to trim the description.
```

## Before filing, re-check (each is a fact that can move)

- The skill URL resolves (Verification above), and `deploylog` is still absent from both registries: `gh api repos/HKUDS/CLI-Anything/contents/public_registry.json -H "Accept: application/vnd.github.raw" | grep -c '"name": "deploylog"'` prints 0 (and exits 1, which is the pass).
- The test count: run `npm test` and put the real number in the PR body.
- The version: if a release lands first, bump `version` and the PR body together.
- Two "Checks" boxes are Marko's to tick when true: the JSON one after `python -m json.tool` passes on the fork, and the install one after `npm install -g deploylog` (or `npx deploylog --version`) runs on his machine. The other two were true on 2026-09-29.
- Run the dash/arrow grep and the `avoid-ai-writing` pass on the PR body again after any edit.

## Boundaries

- Registry-only: no changes to `docs/hub/`, `README.md` or `registry.json` upstream (#425 touched `public_registry.json` alone).
- No "first" or "only changelog CLI on CLI-Hub" claim anywhere (the rule 06 and 07 carry).
- `SKILL.md` says "there is no API-key environment variable". When issue 06 adds the `DEPLOYLOG_API_KEY` fallback, update that line in the same PR.
- One skill body. Issue 06's `plugin/skills/changelog/SKILL.md` and issue 07's `init` copy consume `skills/deploylog/SKILL.md`; they do not fork it.
