# 15 - Release 0.7.1: version bump and release notes (no publish, no tag)

**Status:** in review 2026-10-10 (branch `chore/release-0.7.1`) · **Type:** AFK prep; HUMAN publishes · **Lane:** deploylog-cli
**Parent:** monolith wave 2 item L071, 2026-10-10.
**Blocked by:** nothing. The publish waits on this pull request's merge.
**Verification:** `npm ci`, `npm run build` and `npm test` exit 0; `node dist/index.js --version` prints `0.7.1`; `npm pack --dry-run` names `deploylog-0.7.1.tgz`. Known negative: the same acceptance probe run on `main` before the bump failed all 7 of its arms (`0.7.0` in three version fields and on `--version`, and three stale `Status:` lines).

## What 0.7.1 ships (merged to `main` since v0.7.0)

- `login` and `logout` refuse to run under `sudo` (`SUDO_USER` set): exit 1, and a message that names the fix. Read-only commands such as `whoami` and `--version` keep working. Issue 09, PR #20, merged as c1f260b.
- The CLI exits with its documented code on Windows. The adapter sets `process.exitCode` and returns instead of calling `process.exit`, which aborted in libuv after a request and left the shell with 127. Issue 14, PR #21, merged as dbeff68.
- CI: `ci.yml` runs `npm ci`, `npm run build` and `npm test` on every pull request and push to `main` (Node 22 on Ubuntu and Windows, Node 20 on Ubuntu). Repository only, not in the tarball. Issue 13, PR #19, merged as b843c9f.
- Also on `main` since v0.7.0: the README's "Set up with a coding agent" section (PR #17; the README is in the tarball, so the npm page gains it) and `skills/deploylog/SKILL.md` (PR #18, issue 12 step 1; not in the tarball, since `files` is `dist` only and issue 07 item 2 is still queued).

## What was built

- `npm version 0.7.1 --no-git-tag-version`: `package.json` and both version fields of `package-lock.json`.
- The `Status:` lines of issues 09, 13 and 14 now read "merged as <sha>, ships in 0.7.1 (publish pending, Marko)".
- This file. No source or test change.

## Acceptance

- [x] `package.json` and `package-lock.json` (its root `version` and `packages[""].version`) say `0.7.1`.
- [x] The built CLI prints `0.7.1` for `--version`. `src/index.ts` passes `getCliVersion()` to Commander, and `src/version.test.ts` ties that to `package.json`: with `getCliVersion` planted to return `'0.7.0'`, 2 of its 3 tests failed (`expected '0.7.0' to be '0.7.1'`); restored, the file matched `HEAD` byte for byte.
- [x] The `Status:` lines of issues 09, 13 and 14 name their merge sha and 0.7.1.
- [x] Release notes name #19, #20 and #21: here, in the bump commit's body and in the pull request body.
- [x] `npm ci`, `npm run build` and `npm test` pass.
- [ ] Published to npm and tagged `v0.7.1`: Marko, after the merge (`CLAUDE.md`, "Releasing").

## Defaults taken (not yet confirmed)

Dated 2026-10-10. Each is reversible.

1. **No CHANGELOG file.** The repo has never kept one (no `CHANGELOG*` path in any commit on any branch), and its only GitHub release is v0.3.0. The release notes go where 0.7.0 kept them: the bump commit's body (ff39b3b) and the release pull request's body (#16), plus this file.
2. **A patch bump, 0.7.1, as asked.** Open question: 0.7.0 took a minor bump for "a behaviour change on a contract surface" (PR #16), and #20 makes `sudo deploylog login` exit 1 where it used to succeed. It is treated as a fix here: no command or flag changed, and the run it now refuses wrote the key as root, where later runs without `sudo` either could not find it or could not update it. If the minor-bump precedent should hold, this becomes 0.8.0: re-run `npm version 0.8.0 --no-git-tag-version` and edit the three `Status:` lines.
3. **The sha in each `Status:` line is the pull request's merge commit on `main`**, in short form (c1f260b, b843c9f, dbeff68), read from `gh pr list` on 2026-10-10. Each feature commit is reachable from it.
4. **"ships in 0.7.1" on issue 13 means "on `main` at the 0.7.1 release".** `ci.yml` and its guard test are not in the tarball.
5. **`CLAUDE.md`'s package line stays at `0.7.0`.** It states what is on npm, which stays 0.7.0 until the publish. Update it after the publish, as PR #16 listed for 0.7.0.

## Boundaries

- No `npm publish`, no tag, no GitHub release: those are Marko's (`CLAUDE.md`, "Releasing", steps 3 to 7).
- Not changed: `npm audit --omit=dev` reports fast-uri 3.1.2 (high; under `conf`, via `ajv`) in this repo's lockfile. The lockfile is not in the tarball, and on a fresh install `ajv`'s `^3.0.1` resolves 3.1.8, outside the advisory's 3.0.0 to 3.1.7 range.
