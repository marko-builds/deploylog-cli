<p align="center">
  <img src="https://raw.githubusercontent.com/Idzuo32/deploylog-cli/main/.github/assets/logo.png" width="120" alt="DeployLog" />
</p>

<h1 align="center">deploylog</h1>

<p align="center">
  Push changelog entries from the terminal. Generate release notes from git with one flag. Rewrite them with Claude Haiku with another.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/deploylog"><img src="https://img.shields.io/npm/v/deploylog.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/deploylog"><img src="https://img.shields.io/npm/dm/deploylog.svg" alt="downloads"></a>
  <img src="https://img.shields.io/node/v/deploylog.svg" alt="node">
  <img src="https://img.shields.io/npm/l/deploylog.svg" alt="license">
</p>

---

## Install

```bash
npm i -g deploylog
```

Node 18+ required.

## Authenticate

Create an API key in your dashboard at [deploylog.dev/dashboard/api-keys](https://deploylog.dev/dashboard/api-keys), then:

```bash
deploylog login --key dk_xxx
```

Credentials are stored with [`conf`](https://github.com/sindresorhus/conf) in your OS's standard config directory.

## Quick start

```bash
# List your projects
deploylog projects

# Publish an entry
deploylog push \
  --project my-app \
  --title "Dark mode" \
  --body "Auto-detects system preference." \
  --type feature \
  --version 1.4.0 \
  --publish
```

## Project config

Create a `.deploylog.yml` at your repo root so you don't have to pass `--project` every time:

```yaml
project: my-app
```

## Commands

### `deploylog login`

Authenticate with an API key.

```
--key <key>       API key (starts with dk_)
--api-url <url>   API base URL (default: https://deploylog.dev)
```

### `deploylog logout`

Remove stored credentials.

### `deploylog projects`

List projects in your organization.

### `deploylog list`

List recent entries for a project.

```
-p, --project <slug>   Project slug (or set in .deploylog.yml)
```

### `deploylog push`

Create a new changelog entry.

```
-t, --title <title>       Entry title
-b, --body <markdown>     Entry body (Markdown)
-p, --project <slug>      Project slug (or set in .deploylog.yml)
--type <type>             feature | fix | improvement | breaking | announcement
--version <version>       Semver (e.g. 1.2.3)
--publish                 Publish immediately
--draft                   Save as draft (default)
--from-git                Derive title/body from commits since the last tag
--ai-summarize            Rewrite the entry with Claude Haiku
-y, --yes                 Skip interactive confirmation for AI-generated content
```

## Recipes

**Draft from recent commits:**

```bash
deploylog push --from-git
```

Collects commits since the last git tag, formats them as a Markdown list, and opens the entry as a draft.

**AI-polished release notes:**

```bash
deploylog push --from-git --ai-summarize --version 1.4.0 --publish
```

Uses Claude Haiku to rewrite your raw commits into user-friendly release notes. Free plan includes 5 AI summaries per month; paid plans are unlimited.

**CI / GitHub Actions:**

For CI workflows, prefer the official Action:

- [`deploylogdev/action`](https://github.com/marketplace/actions/deploylog) on the GitHub Marketplace

## Related

- **Dashboard** — [deploylog.dev](https://deploylog.dev)
- **Widget** — embeddable changelog widget at `cdn.deploylog.dev`
- **GitHub Action** — [`deploylogdev/action@v1`](https://github.com/marketplace/actions/deploylog)

## License

MIT © DeployLog
