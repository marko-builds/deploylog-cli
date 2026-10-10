# 09 — Refuse credential/global commands under sudo

**Status:** built 2026-10-10 on branch `feat/09-refuse-login-under-sudo`, unmerged and unreleased · **Type:** AFK · **Lane:** deploylog-cli
**Parent:** none — mined from the pnpm 12.0 release notes (`references/transcripts/145.txt`)
**Blocked by:** None
**Verification:** unit tests over an injected `isSudo`/env seam (no real sudo in the harness, and none is available from the agent sandbox anyway). Signal: `vitest run`.

## What to build

`config.ts` stores the API key with `conf`, which writes to the invoking user's OS config dir.
There is no sudo check anywhere in `src/` (`grep -rn "SUDO_USER\|getuid\|sudo" src/` → nothing).

The failure it allows: a user who installs globally with `sudo npm i -g deploylog` carries the
habit to `sudo deploylog login`. The key lands in **root's** config dir. Every later non-sudo
`deploylog push` then reports no credentials, and `deploylog config path` (run without sudo) points
at a file that does not contain the key. Nothing in that sequence says "you saved this as root."

pnpm 12 fails these with a named error, `ERR_PNPM_SUDO_NOT_SUPPORTED`, and the reasoning transfers
exactly: pnpm keeps global packages and config in the invoking user's home, so these commands never
need root. **Read-only** global commands (`pnpm bin --global`) keep working.

- Detect sudo as `process.env['SUDO_USER'] !== undefined` (present under `sudo`, absent under a
  real root login and under `su`). Prefer it over `process.getuid() === 0`, which would also refuse
  a container running legitimately as root — a false refusal costs what a false pass costs.
- Refuse only the commands that **write** credentials or global state: `login`, `logout`, and any
  future config-writing subcommand.
- Leave read-only commands working: `config path`, `--version`, `--help`, `whoami`, and anything
  that only reads the store. A user debugging the mess this prevents needs `config path` to answer.
- Message must name the fix, not just the refusal: run it without `sudo`, and if the install itself
  needed root that is an npm-prefix problem, not a deploylog one.
- Typed refusal per convention 2 — a `kind` on the domain result, the adapter picks the exit code.
  Do not `process.exit` inside the domain function.

## Acceptance criteria

- [x] `SUDO_USER` set → `login` / `logout` refuse with a typed, named refusal and a non-zero exit.
      (`kind: 'sudo-not-supported'` in `src/login.test.ts`; exit 1 is set by the `src/index.ts`
      adapter, which no suite test reaches, and is checked by `issues/09/smoke-sudo.mjs`, default (h))
- [x] `SUDO_USER` set → read-only commands (`config path`, `whoami`, `--version`) still work.
      (`config path` does not exist, default (a); see the smoke note below)
- [x] `SUDO_USER` unset → every command behaves exactly as today (the calibration arm: assert the
      guard is silent when it should be, or it is a check that always fires).
- [x] Root **without** `SUDO_USER` (a container running as root) is NOT refused, with a test.
- [ ] `--json` mode emits the refusal as `{"error":{"code","message"}}` on stderr, per convention 3.
      (not built: `login` / `logout` take no `--json`, default (b))
- [x] `npm test` and `npm run build` pass.

## Boundaries

- Does not attempt to migrate a key already written to root's store. Detecting that would mean
  reading a path this process cannot read without root. Out of scope; the message is the remedy.
- Does not touch `.deploylog.yml` handling (issue 08) — different file, different failure.
- Ships with issue 06's `DEPLOYLOG_API_KEY` env fallback or before it; they do not conflict, but
  the env fallback changes what "no credentials" means, so land whichever first and re-read the
  other's acceptance list.

## Defaults taken (not yet confirmed)

Dated 2026-10-10, built on branch `feat/09-refuse-login-under-sudo`. Each is reversible.

- **(a) No `config path` command.** The issue names `deploylog config path` as a read-only
  command to keep working; no `config` command exists in `src/index.ts`. None was added. The
  read-only arm uses `--version`, `--help` and `whoami` (`whoami --json` already prints
  `config_path`).
- **(b) No `--json` on `login` / `logout`.** Neither command takes `--json` today, and convention 3
  covers data commands. The refusal is plain text on stderr with exit 1. If a flag is added later,
  the adapters' existing rule (`kind.toUpperCase()` with `-` to `_`) turns the kind into the code
  `SUDO_NOT_SUPPORTED`.
- **(c) Exit code 1**, the same as every other refusal in `src/index.ts`, not a dedicated code.
- **(d) Detection is exactly `SUDO_USER !== undefined`**, as specified; uid is never consulted.
  `getuid` is in `LoginDeps['proc']` only so tests can hand over any uid and prove it never
  decides: uid 0 without `SUDO_USER` is not refused, and every sudo shape is (sudo as root,
  `sudo -u` to a non-root uid, a process with no `getuid` as on Windows, and an empty
  `SUDO_USER`, which the `!== undefined` spec refuses). A `SUDO_USER` left in the environment
  after `su` from a sudo shell is refused too; the message says `(SUDO_USER is set)` so that case
  can see its cause.
- **(e) `login`'s logic moved verbatim** from `src/index.ts` into `runLogin` in `src/login.ts`
  (convention 1), order unchanged: `--api-url` is validated and saved before the key is checked,
  so a valid URL with a bad key still saves the URL, as before. The prompt text is unchanged.
- **(f) The npm-prefix half of the fix links npm's own page**, "Resolving EACCES permissions errors
  when installing packages globally" (200 on 2026-10-10; a made-up sibling path returned 404).
- **(g) Chapter 05 of the Manual** cites the login messages in `src/index.ts`; they now live in
  `src/login.ts`, so `manual-check.yml` may annotate drift on the PR (`fail-on: none`, so it stays
  green). The chapter regenerates on the deploylog side.
- **(h) Read-only commands under `SUDO_USER`, and the refusal's exit code, are checked by a smoke
  run, not a suite test.** `src/index.ts` has no seam, and the read-only commands never call the
  guard. The run is `issues/09/smoke-sudo.mjs` (`npm run build && node issues/09/smoke-sudo.mjs`):
  the built CLI, with its config dir pointed at a temp sandbox and a local fake API. On 2026-10-10
  it passed 8 of 8: `--version`, `--help` and `whoami --json` work with `SUDO_USER` set; `login`
  and `logout` refuse with exit 1 and leave the store unchanged; both work with it unset. Its
  exit-code arms can fail: with both adapters' `process.exit(1)` patched to `exit(0)` in `dist/`,
  steps 3 and 6 failed and the run exited 1. The suite's own arms are calibrated by
  `issues/09/mutate-login.mjs` (`node issues/09/mutate-login.mjs`): one mutation of `src/login.ts`
  per arm, each counted only when vitest exits 1 with a FAIL line for the test it names; 11 of 11
  caught on 2026-10-10.
- **(i) Not changed:** `conf` writes its `apiUrl` default when the CLI starts, so any command
  under sudo, `--version` included, creates the sudo user's config file with that default (seen in
  the smoke run). It holds no credential. `conf` 13.1.0 writes there only when the file lacks that
  default (it compares the file with defaults-plus-file and writes on a difference), so an existing
  store is left alone. Where sudo keeps HOME (default (j)) and the user has no config yet, the file
  it creates is the user's own, root-owned. Left unguarded: the issue keeps read-only commands
  working under sudo.
- **(j) The refusal names both places a sudo write can land, not one.** `conf` resolves its dir
  through `env-paths`, which builds every path from `os.homedir()`, and Node's `os.homedir()`
  follows `$HOME` on POSIX. So the premise above ("the key lands in root's config dir") holds only
  where sudo resets HOME. Where sudo keeps HOME, the key lands in the user's OWN config as a
  root-owned file: non-sudo reads still find it, and later non-sudo `login` / `logout` cannot
  update it. The `login` / `logout` messages and the README say "written as root: into root's
  config, or into yours as a root-owned file". The guard is the same either way.
  **Open question:** which platforms keep HOME under sudo by default. sudoers(5) for sudo 1.9.15p5
  (read on 2026-10-10 in this box's WSL Ubuntu 24.04) says that with `env_reset` on, its default,
  HOME is initialized from the target user, and it survives only when `env_reset` is off or HOME is
  in `env_keep`. So stock Linux is expected to reset it; this was read, not run (sudo there needs a
  password, so no non-interactive probe). macOS's stock sudoers is believed to put HOME in
  `env_keep`, unverified (no macOS box). It changes only which half of the message applies, never
  whether to refuse.
