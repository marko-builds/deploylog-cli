# 11 — `search_history` MCP tool + `why` prompt, and the human gate

**Status:** queued (v1.2, after issues 06 and 10) · **Type:** HUMAN (foreground; the gate is the point) · **Lane:** deploylog-cli
**Parent:** issue 10; monolith `decisions/log.md` 2026-09-16
**Blocked by:** 06-mcp-server.md (the server), 10-why-search.md (the function)
**Verification:** on a clean box with the MCP server installed, an agent session asks a why-question about a public repo; the tool returns ranked results with URLs and the agent's answer cites them. Determinism is proven at `runWhy` over a frozen cache (acceptance 2), not by comparing two live invocations, which can legitimately differ across a refresh. Known negative: a repo the token cannot read returns a tool error carrying `not-found` or `no-token`, never an empty result. **Human gate:** the friend runs `deploylog why` on his .NET library with three questions he already knows the answer to; the right thread is in the top five for at least two of three. Below that the tool does not ship and the ranking (issue 10) reopens.

## What to build
- Tool `search_history { repo?, query, kinds?, limit? }` returning issue 10's `--json` shape through `runWhy` with real deps. `repo` optional: resolved from the server's cwd the way issue 06 resolves the project; the result echoes the resolved repo so the host prompt names it.
- Prompt `why { question, repo? }`: tells the agent to call `search_history`, read the top threads (fetching a URL is the agent's own tool call), answer with citations, and say when the evidence is thin.
- The tool description states: read-only, local cache, a first run on a large repo can take minutes and may stop at the GitHub rate limit (resumable on the next call).
- Docs page and README: one paragraph and one example transcript.

## Acceptance criteria
- [ ] Tool and prompt registered; `claude mcp add deploylog -- npx -y deploylog mcp` exposes both; the prompt shows as a slash command in Claude Code.
- [ ] `search_history` and `deploylog why --json` share `runWhy`; a test asserts the same input yields the same ranked refs.
- [ ] Measured and written here: index build time on a real repo with more than 5k threads (persist the index in v1 if above 2 s), the backfill's point cost and wall time on the friend's library, and whether the 50-comment cap dropped the expected thread on any of his three questions.
- [ ] The known negative above passes.
- [ ] The human gate is recorded in this file: the three questions, the ranks, the date, the library.

## Boundaries
- No synthesis inside the tool, no LLM call, no telemetry beyond issue 06's User-Agent line.
- No polling; one call per question.
- Does not ship before the human gate passes. Do NOT queue this to `afk-implement.sh`.
