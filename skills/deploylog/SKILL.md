---
name: deploylog
description: >-
  Push, review and publish changelog entries with the deploylog CLI, and check a
  project's Manual against the code it cites. Use when the user wants release
  notes or a changelog entry from recent commits, wants to list, edit, publish or
  unpublish DeployLog entries, or wants to verify their DeployLog Manual in CI.
  Entries are drafts by default; nothing is published or deleted without an
  explicit command or flag.
---

# deploylog

`deploylog` (alias `dpl`) is the command-line client for [DeployLog](https://deploylog.dev):
changelog entries, the public changelog page they publish to, and a product Manual whose claims
are checked against the files they cite.

## Setup

- Node 18+. Install with `npm install -g deploylog`, or run `npx deploylog <command>`.
- The person authenticates, not the agent. They create a key on the API Keys page of the
  DeployLog dashboard and run `deploylog login` in their own terminal, which prompts for it. Never
  ask for the key, print it, or put a literal key on a command line or in a file. If a command
  fails with 401 or "Not authenticated", ask the person to log in rather than working around it.
  In CI, where no person is present, a workflow step may run
  `deploylog login --key "$DEPLOYLOG_API_KEY"` with the variable set from a repository secret.
  The key is stored in the OS config directory; the CLI reads no API-key environment variable on
  its own.
- `deploylog whoami --json` shows the organization, plan, the key's permissions (`read`, `write`,
  `publish`, `delete`) and AI usage this month. Run it first when a command fails with 401 or 403.
- Point a repository at a project with `deploylog init --project <slug> --json`, which writes
  `.deploylog.yml`. `deploylog projects --json` lists the slugs. If the organization has exactly
  one project, `--project` can be left out; with several, non-interactive mode requires it.

## Rules

1. **Pass `--json` to every command except `login` and `logout`.** The data goes to stdout.
   Errors go to stderr as `{"error":{"code","message"}}` with exit code 1, and progress lines go to
   stderr too. In `--json` mode no command ever prompts.
2. **Reference entries by `id`, not slug.** A draft's slug changes when its title changes;
   `edit --json` returns the old one as `previous_slug`.
3. **Draft, read back, then publish on the user's approval.** `push` saves a draft unless
   `--publish` is passed. Publishing is public: the entry appears on the project's changelog page
   and feeds, and on Pro plans subscribers get an email digest (first publish only). Do not pass
   `--publish` to `push` unless the user asked for it.
4. **`--ai-summarize` does not ask for confirmation in a non-interactive shell.** It proceeds with
   the generated entry, so pair it with a draft, never with `--publish`.
5. **`delete` is permanent** and needs `--yes` in `--json` mode. When the user wants an entry off
   the public page, use `unpublish`, which reverts it to a draft.
6. **Do not loop or poll.** The API allows 60 requests a minute per organization, shared with the
   DeployLog GitHub Action. A 429 response carries `Retry-After`.

## Entry fields

- `-T, --type`: one of `feature`, `fix`, `improvement`, `breaking`, `announcement`.
- `--version`: plain semver such as `1.4.0`, with no `v` prefix.
- `-b, --body`: Markdown.
- Program options go before the subcommand: `deploylog push --version 1.4.0` sets the entry's
  version, while `deploylog --version` prints the CLI's own version.

## Which project a command targets

`--project <slug>` wins. Without it, the CLI walks up from the current directory to the nearest
`.deploylog.yml`. In a monorepo, running from a parent directory picks up the parent's project,
so pass `--project` when in doubt. A malformed `.deploylog.yml` stops the walk with an error
rather than falling through to a parent's file.

## Common flows

Release notes from the commits since the last tag, saved as a draft:

```bash
deploylog push --from-git --json
# or rewritten into user-facing notes (counts against the plan's monthly AI usage):
deploylog push --from-git --ai-summarize --json
```

`--ai-summarize` needs source material: `--from-git` commits, or raw notes in `--body`. When
there are no commits since the last tag, `push --from-git` exits 1 with `NO_COMMITS`.

Read the draft back, then publish once the user approves:

```bash
deploylog view <id> --json
deploylog publish <id> --json
```

A hand-written entry:

```bash
deploylog push -t "Faster CSV exports" -b "Exports now stream instead of buffering." \
  -T improvement --version 1.4.0 --json
```

Review and change entries:

```bash
deploylog list --drafts --json               # or --published, -T <type>, -n <1-50>
deploylog edit <id> --body-file notes.md --json   # or --title, --type, --version, --body; --body-file - reads stdin
deploylog unpublish <id> --json
```

Import GitHub releases as drafts (private repos need `--token` or `DEPLOYLOG_GITHUB_TOKEN`):

```bash
deploylog import github owner/repo --json
```

`deploylog open [id] --json` opens the public changelog, or one entry's page, in the user's
browser when a display is available, and returns `{"url", "opened"}`. To only share the link,
read `url` and do not repeat the call.

## Manual verify

A DeployLog Manual is product documentation whose claims cite files in the repository.
`deploylog manual verify` asks the server to check those claims at a commit on GitHub:

```bash
deploylog manual verify --json                                        # whole manual at HEAD
deploylog manual verify --changed-from origin/main --fail-on any --json   # only claims citing changed files
```

- The exit code is the answer: `0` clean, `1` a cited value drifted, `2` the run could not vouch
  for the manual. In `--json` mode an error also exits 1, so check stderr for the error envelope
  before reading a 1 as drift.
- `--fail-on none | drift | any` (default `drift`) sets what fails the run. `none` reports
  without failing; `any` also fails on claims that could not be read.
- It checks the commit on GitHub, so push first. Uncommitted changes are not what gets verified.
- `--repository owner/repo` and `--ref <sha>` override the defaults taken from `git remote` and
  `HEAD`.
- `deploylog manual export -o - --json` prints the whole manual (versions, chapters, claims) as JSON.
