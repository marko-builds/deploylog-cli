import { execFileSync } from 'node:child_process'

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

/**
 * Thin shell-out wrapper. Exported for test injection.
 * Returns stdout with trailing newline trimmed, or null on non-zero exit.
 */
export function runGit(args: string[], cwd: string = process.cwd()): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\n$/, '')
  } catch {
    return null
  }
}

export interface GitRunner {
  (args: string[]): string | null
}

export function isGitRepo(run: GitRunner = runGit): boolean {
  return run(['rev-parse', '--is-inside-work-tree']) === 'true'
}

/**
 * Most recent annotated or lightweight tag reachable from HEAD, or null.
 */
export function getLastTag(run: GitRunner = runGit): string | null {
  const out = run(['describe', '--tags', '--abbrev=0'])
  return out && out.length > 0 ? out : null
}

/**
 * If HEAD is on a tag that looks like semver (v1.2.3 or 1.2.3), return the
 * bare semver string (without the 'v'). Otherwise null.
 */
export function getHeadVersion(run: GitRunner = runGit): string | null {
  const exact = run(['tag', '--points-at', 'HEAD'])
  if (!exact) return null
  for (const line of exact.split('\n')) {
    const m = line.match(/^v?(\d+\.\d+\.\d+)$/)
    if (m?.[1]) return m[1]
  }
  return null
}

export interface CommitSummary {
  hash: string
  subject: string
}

/**
 * Commit subjects (and short hashes) between `ref` and HEAD, oldest-first.
 * If `ref` is null, returns the most recent `limit` commits on HEAD.
 */
export function getCommitsSince(
  ref: string | null,
  limit = 200,
  run: GitRunner = runGit,
): CommitSummary[] {
  const range = ref ? `${ref}..HEAD` : 'HEAD'
  const args = ['log', range, `--pretty=format:%h\t%s`, '--no-merges', `-${limit}`, '--reverse']
  const out = run(args)
  if (out === null) {
    // `ref..HEAD` with an unknown ref (or an empty repo) returns null via our wrapper.
    return []
  }
  if (out.length === 0) return []

  const commits: CommitSummary[] = []
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const hash = line.slice(0, tab)
    const subject = line.slice(tab + 1).trim()
    if (subject.length > 0) commits.push({ hash, subject })
  }
  return commits
}

/**
 * Derive a sensible default title from the latest tag (or fallback).
 */
export function defaultTitleFromGit(version: string | null, lastTag: string | null): string {
  if (version) return `Release v${version}`
  if (lastTag) return `Changes since ${lastTag}`
  return 'Recent changes'
}

/**
 * Format a commit list as a markdown bullet body.
 */
export function formatCommitsAsMarkdown(commits: CommitSummary[]): string {
  if (commits.length === 0) return '_No new commits since last tag._'
  return commits.map((c) => `- ${c.subject}`).join('\n')
}
