# 14 — Exit with the documented code on Windows (no `process.exit` after a request)

**Status:** in review 2026-10-10 (branch `fix/windows-exit-code`) · **Type:** AFK · **Lane:** deploylog-cli
**Parent:** Marko's repro 2026-10-10 (`deploylog manual verify` from a deploylog checkout, Windows 11, Node v24.19.0, `deploylog@0.7.0` global)
**Blocked by:** None
**Verification:** `vitest run src/index.test.ts`: 10 tests, 8 red on the old `index.ts`. One mutation per arm, each failing only its arm: code 2 collapsed to 1, a clean run set to 1, the invalid `--fail-on` return dropped, the `list` project refusal ignored, `handleError` not setting the code, the `list` flag-conflict return dropped, the verify refusal not setting the code, one `process.exit` reintroduced in `view`. End to end on Windows against production: the fixed `dist/` exits 1 with no assertion on 5 of 5 `manual verify` runs (3 human, 2 `--json`, stdout parses), and `whoami` on a 401 exits 1 on 3 of 3 where the old `dist/` exited 127 on 3 of 3.

## What was wrong

On Windows, any command that failed after an API call printed its whole output, then aborted with
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`, and the
shell saw 127 instead of the documented code. `manual verify` with drift exited 127, not 1, and
`--fail-on any` could no longer tell drift (1) from "could not vouch" (2).

The cause is `process.exit()` while the fetch's TLS socket is still closing. Probes on 2026-10-10,
Node v24.19.0: `await fetch(https://deploylog.dev/...)` then `process.exit(1)` aborted on 17 of 24
runs (13 of 15 in the last batch), with any `accept-encoding` and with `Connection: close`; the
same against a local plain-HTTP server, gzip included, aborted on 0 of 9; `process.exitCode = 1`
after the production fetch aborted on 0 of 5. Same shape as earendil-works/pi#5805 (global
`fetch`, Windows, 127). No Node fix is confirmed.

A run that passes never called `process.exit`, so it was never affected: `--fail-on none` on the
same drifted checkout exited 0. A `deploylog manual verify || exit 1` pre-push hook therefore
blocked only failing runs, as intended, just with 127 instead of 1.

## What was built

- `index.ts` never calls `process.exit`: every failure sets `process.exitCode` and returns (or
  `break`s from a switch case that is not last). `handleError` sets the code first;
  `resolveProject` now returns `undefined` after printing its refusal and the two callers return.
- `manual verify` sets `process.exitCode = result.exitCode` unconditionally.
- `src/index.test.ts`: imports the adapter with its modules mocked and asserts the exit status
  each path leaves, with `process.exit` spied; plus a TypeScript AST walk over every non-test
  `src/*.ts` that fails on `process.exit` in any of four spellings, calibrated on planted ones.
- No measurable exit latency from letting the loop drain (whoami old 1.66 to 2.52 s, new 1.58 to
  2.42 s, n=3 each).

## Boundaries

- Commander's own exits (`--help`, `--version`, an unknown option) still call `process.exit`.
  They run before any request, so no socket exists to abort on.
- No surface change: same messages, same codes, same flags. No version bump here; a patch release
  is Marko's call.
- PR #20 rewrites the `login` action and keeps one `process.exit(1)` in it. Whichever lands second
  resolves `login` by hand, and `index.test.ts` fails until that call becomes `process.exitCode = 1`
  plus a `return`.
