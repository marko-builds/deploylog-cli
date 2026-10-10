# 13 - Run the build and test suite in CI (`ci.yml`)

**Status:** merged as b843c9f, ships in 0.7.1 (publish pending, Marko) · **Type:** AFK build; HUMAN to confirm the defaults below and merge · **Lane:** deploylog-cli
**Parent:** monolith backlog item E11, triaged 2026-10-10 (no issue file existed for it before this one).
**Blocked by:** nothing.
**Verification:** locally, `npm ci`, `npm run build`, `npm test` exit 0, and a mutation harness over `ci.yml` turns `src/ci-workflow.test.ts` red for every edit listed under Acceptance while three controls stay green. On GitHub, the pull request for this branch should run `ci.yml` on itself (GitHub documents that a `pull_request` workflow runs from the pull request's merge commit, so the workflow that adds it applies; not yet observed here) and its three `test (...)` jobs report green. Known negative: the Manual check alone is not evidence, since it runs no tests.

## Why

Measured 2026-10-10: the only workflow in the repo was `manual-check.yml` (`gh workflow list`), it is the only one that has ever run (7 runs, all "Manual check"), and `gh run list --branch main` returns 0 runs. No workflow had ever run the test suite, so a green check on a CLI pull request proved the Manual check and nothing else.

## What to build

- `.github/workflows/ci.yml`: on push to `main` and on every `pull_request`, run the repo's gate from `CLAUDE.md`: `npm ci`, `npm run build`, `npm test`.
- Pinned major action versions: `actions/checkout@v4`, `actions/setup-node@v4`.
- A guard test that reads the real `ci.yml`, so an edit that quietly switches the gate off fails `npm test`.
- `CLAUDE.md`'s build/test line describes what CI runs, and claims only what was run.

## Acceptance

- `ci.yml` runs the three gate commands, in order, in every job of the matrix below.
- `src/ci-workflow.test.ts` fails when the `pull_request` trigger is removed; filtered by `branches`, `branches-ignore`, `paths` or `paths-ignore`; or given a `types` list that leaves out `opened`, `synchronize` or `reopened`; when push to `main` is dropped; when a gate step is removed, reordered or rewritten (`npm test || true`); and when a job or a gate step gets an `if` or a `continue-on-error`. Each of those was run as a mutation of the real `ci.yml` and failed on its own assertion (25-arm harness, 2026-10-10: 22 red; the 3 controls, no change, a `types` superset and a non-gate step with `if: failure()`, green).
- The guard is a local check: a pull request that edits `ci.yml` runs its edited copy, so that pull request's own checks cannot be relied on to catch the edit. `CLAUDE.md`, the `ci.yml` header and the test's comment say so.
- The local gate passes. The Linux and Node 20 jobs are proven only by the first GitHub run; `CLAUDE.md` says Windows until then.

## Defaults taken (not yet confirmed)

Taken 2026-10-10, each reversible in one edit to `ci.yml` or the test. Marko confirms them as one batch.

1. **Matrix: Node 22 on `ubuntu-latest` and `windows-latest`, plus Node 20 on `ubuntu-latest`.** `package.json` has no `engines` field, so the README's "Node 18+" was the nearest claim. Node 18 cannot run the suite: vite 8.0.16, under vitest 4.1.4, declares `^20.19.0 || >=22.12.0`. Node 24, which this box runs, is not in the matrix. **Open question:** keep the README at Node 18+ (the CLI may still run there, but nothing tests it), raise it to Node 20, or add an `engines` field.
2. **`fail-fast: false`.** One failing combination does not cancel the others, so a red run shows which OS and Node broke.
3. **`permissions: contents: read`.** The workflow only reads the repository, so the token gets nothing more.
4. **npm cache through `actions/setup-node` (`cache: npm`)**, keyed on `package-lock.json`.
5. **No `concurrency` block and no `paths` filter.** Every push to a pull request runs all three jobs, docs-only changes included, and a superseded run is not cancelled. A `paths` filter on `pull_request` would also fail the guard test.
6. **The guard test sits in `src/` (`src/ci-workflow.test.ts`)**, so `vitest run` finds it with no config file and `tsc` skips it (`src/**/*.test.ts` is excluded). It parses `ci.yml` with `yaml`, already a runtime dependency.
7. **The guard refuses `if` and `continue-on-error` only on jobs and on the three gate steps**, so a non-gate step such as `if: failure()` stays allowed, and it accepts a `types` list that includes the three default activity types (a superset such as adding `ready_for_review` passes).

## Boundaries

- No new dependencies. `manual-check.yml` is untouched.
- Making the `test (...)` checks required in a branch ruleset is a repository setting and Marko's call. It is the setting that would hold a pull request that removes the trigger (its required checks would never report), unless an admin merge bypasses it.
- No publish, release or tag.
