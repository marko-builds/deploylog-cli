#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { setApiKey, setApiUrl, getConfigPath, clearConfig } from './config.js'
import {
  listProjects,
  listEntries,
  createEntry,
  summarize,
  ApiError,
  type AiSummary,
} from './api.js'
import { readProjectConfig } from './project-config.js'
import {
  isGitRepo,
  getLastTag,
  getHeadVersion,
  getCommitsSince,
  defaultTitleFromGit,
  formatCommitsAsMarkdown,
  type CommitSummary,
} from './git.js'

const program = new Command()

program
  .name('deploylog')
  .description('Push changelog entries from the terminal')
  .version('0.2.2')

// ─── login ──────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with an API key')
  .option('--key <key>', 'API key (starts with dk_)')
  .option('--api-url <url>', 'API base URL (default: https://deploylog.dev)')
  .action(async (opts: { key?: string; apiUrl?: string }) => {
    if (opts.apiUrl) {
      let parsed: URL
      try {
        parsed = new URL(opts.apiUrl.trim())
      } catch {
        console.error(chalk.red('Invalid API URL. Provide a valid absolute URL.'))
        process.exit(1)
      }
      // Require http(s) and a real host — a scheme-only value like "https://"
      // parses but would break request URL construction.
      if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
        console.error(chalk.red('Invalid API URL. Must use http(s) and include a host.'))
        process.exit(1)
      }
      setApiUrl(opts.apiUrl)
    }

    if (opts.key) {
      if (!opts.key.startsWith('dk_')) {
        console.error(chalk.red('Invalid API key. Keys start with dk_'))
        process.exit(1)
      }
      setApiKey(opts.key)
      console.log(chalk.green('Authenticated successfully.'))
      console.log(chalk.dim(`Config saved to ${getConfigPath()}`))
      return
    }

    // Interactive: prompt for key
    const { createInterface } = await import('node:readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout })

    const key = await new Promise<string>((resolve) => {
      rl.question('Enter your API key (from Dashboard → API Keys): ', resolve)
    })
    rl.close()

    const trimmed = key.trim()
    if (!trimmed.startsWith('dk_')) {
      console.error(chalk.red('Invalid API key. Keys start with dk_'))
      process.exit(1)
    }

    setApiKey(trimmed)
    console.log(chalk.green('Authenticated successfully.'))
    console.log(chalk.dim(`Config saved to ${getConfigPath()}`))
  })

// ─── logout ─────────────────────────────────────────────────────────────────

program
  .command('logout')
  .description('Remove stored credentials')
  .action(() => {
    clearConfig()
    console.log(chalk.green('Logged out. Credentials removed.'))
  })

// ─── projects ───────────────────────────────────────────────────────────────

program
  .command('projects')
  .description('List projects in your organization')
  .action(async () => {
    try {
      const projects = await listProjects()

      if (projects.length === 0) {
        console.log(chalk.dim('No projects found.'))
        return
      }

      console.log(chalk.bold('Projects:\n'))
      for (const p of projects) {
        console.log(`  ${chalk.cyan(p.name)}  ${chalk.dim(p.slug)}`)
      }
    } catch (err) {
      handleError(err)
    }
  })

// ─── list ───────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List recent entries for a project')
  .option('-p, --project <slug>', 'Project slug (or set in .deploylog.yml)')
  .action(async (opts: { project?: string }) => {
    try {
      const slug = resolveProject(opts.project)
      const entries = await listEntries(slug)

      if (entries.length === 0) {
        console.log(chalk.dim('No entries found.'))
        return
      }

      console.log(chalk.bold(`Entries for ${slug}:\n`))
      for (const e of entries) {
        const status = e.published
          ? chalk.green('published')
          : chalk.yellow('draft')
        const type = e.entry_type ? chalk.dim(`[${e.entry_type}]`) : ''
        const version = e.version ? chalk.dim(`v${e.version}`) : ''
        const date = new Date(e.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })

        console.log(`  ${status}  ${e.title}  ${type}  ${version}  ${chalk.dim(date)}`)
      }
    } catch (err) {
      handleError(err)
    }
  })

// ─── push ───────────────────────────────────────────────────────────────────

program
  .command('push')
  .description('Create a new changelog entry')
  .option('-t, --title <title>', 'Entry title (required unless --from-git or --ai-summarize)')
  .option('-b, --body <markdown>', 'Entry body (Markdown)')
  .option('-p, --project <slug>', 'Project slug (or set in .deploylog.yml)')
  .option('--type <type>', 'Entry type: feature, fix, improvement, breaking, announcement')
  .option('--version <version>', 'Semver version (e.g. 1.2.3)')
  .option('--publish', 'Publish immediately (default: draft)')
  .option('--draft', 'Save as draft (default)')
  .option('-g, --from-git', 'Derive title/body from commits since the last tag')
  .option('--git', 'Alias of --from-git')
  .option('-a, --ai-summarize', 'Rewrite the entry with Claude Haiku (user-friendly release notes)')
  .option('--ai', 'Alias of --ai-summarize')
  .option('-y, --yes', 'Skip interactive confirmation for AI-generated content')
  .action(async (opts: {
    title?: string
    body?: string
    project?: string
    type?: string
    version?: string
    publish?: boolean
    draft?: boolean
    fromGit?: boolean
    git?: boolean
    aiSummarize?: boolean
    ai?: boolean
    yes?: boolean
  }) => {
    try {
      // Reconcile each flag with its alias (-g/--git, -a/--ai).
      const fromGit = opts.fromGit || opts.git
      const aiSummarize = opts.aiSummarize || opts.ai

      const slug = resolveProject(opts.project)
      const projectConfig = readProjectConfig()

      // Gather source material (commits + version) if --from-git.
      let commits: CommitSummary[] = []
      let gitVersion: string | null = null
      let gitTitle: string | null = null
      let gitBody: string | null = null

      if (fromGit) {
        if (!isGitRepo()) {
          console.error(chalk.red('Not in a git repository. Remove --from-git or cd to a repo.'))
          process.exit(1)
        }
        const lastTag = getLastTag()
        commits = getCommitsSince(lastTag)
        gitVersion = getHeadVersion()
        gitTitle = defaultTitleFromGit(gitVersion, lastTag)
        gitBody = formatCommitsAsMarkdown(commits)

        if (commits.length === 0 && !opts.body && !aiSummarize) {
          console.error(
            chalk.yellow(
              lastTag
                ? `No commits since tag ${lastTag}. Nothing to summarize.`
                : 'No commits found on HEAD.',
            ),
          )
          process.exit(1)
        }
      }

      // Build the entry (with optional AI rewrite).
      let title = opts.title ?? gitTitle ?? ''
      let body = opts.body ?? gitBody ?? ''
      let entryType = opts.type ?? projectConfig?.default_type ?? null
      const version = opts.version ?? gitVersion ?? undefined

      if (aiSummarize) {
        const hasSource = commits.length > 0 || (opts.body && opts.body.trim().length > 0)
        if (!hasSource) {
          console.error(
            chalk.red(
              '--ai-summarize needs source material. Pass --from-git or provide --body as raw notes.',
            ),
          )
          process.exit(1)
        }

        process.stdout.write(chalk.dim('Summarizing with Claude Haiku... '))
        const res = await summarize({
          project_slug: slug,
          commits: commits.map((c) => c.subject),
          release_notes: opts.body,
          version,
        })
        process.stdout.write(chalk.green('done\n'))

        title = opts.title ?? res.summary.title
        body = res.summary.body_markdown
        entryType = opts.type ?? res.summary.entry_type
        printAiPreview(res.summary, res.usage)

        if (!opts.yes && process.stdin.isTTY) {
          const ok = await confirm('Publish this entry?')
          if (!ok) {
            console.log(chalk.yellow('Cancelled. No entry was created.'))
            return
          }
        } else if (!opts.yes) {
          // Non-interactive shell (CI, piped stdin): there's no prompt to show,
          // so make the unreviewed auto-proceed explicit. (BUG-019)
          console.log(
            chalk.yellow(
              'Non-interactive shell: proceeding with the AI-generated entry without confirmation.',
            ),
          )
        }
      }

      if (!title || !body) {
        console.error(
          chalk.red(
            'Entry requires --title and --body (or --from-git / --ai-summarize to derive them).',
          ),
        )
        process.exit(1)
      }

      if (opts.publish && opts.draft) {
        console.log(chalk.yellow('Both --publish and --draft passed; saving as a draft.'))
      }

      const entry = await createEntry(slug, {
        title,
        body_markdown: body,
        entry_type: entryType,
        version,
        publish: opts.publish && !opts.draft,
      })

      const status = entry.published
        ? chalk.green('Published')
        : chalk.yellow('Draft')

      console.log(`\n${chalk.green('✓')} Entry created: ${chalk.bold(entry.title)}`)
      console.log(`  Status: ${status}`)
      console.log(`  Slug:   ${chalk.dim(entry.slug)}`)
      if (entry.version) console.log(`  Version: ${chalk.dim(`v${entry.version}`)}`)
    } catch (err) {
      handleError(err)
    }
  })

// ─── helpers ────────────────────────────────────────────────────────────────

function printAiPreview(
  summary: AiSummary,
  usage: { used: number; limit: number | null; month_key: string },
): void {
  console.log()
  console.log(chalk.bold('AI-generated entry:'))
  console.log(`  ${chalk.dim('Title:')}  ${summary.title}`)
  console.log(`  ${chalk.dim('Type:')}   ${summary.entry_type}`)
  console.log(chalk.dim('  Body:'))
  for (const line of summary.body_markdown.split('\n')) {
    console.log(`    ${line}`)
  }
  const limitLabel = usage.limit === null ? '∞' : String(usage.limit)
  console.log(chalk.dim(`  Usage:  ${usage.used}/${limitLabel} this month (${usage.month_key})`))
  console.log()
}

async function confirm(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} [y/N] `, resolve)
  })
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

function resolveProject(cliArg?: string): string {
  if (cliArg) return cliArg

  const config = readProjectConfig()
  if (config?.project) return config.project

  console.error(chalk.red('No project specified.'))
  console.error('Use --project <slug> or create a .deploylog.yml with:')
  console.error(chalk.dim('  project: my-app'))
  process.exit(1)
}

function handleError(err: unknown): void {
  if (err instanceof ApiError) {
    console.error(chalk.red(`Error: ${err.message}`))
    if (err.status === 401) {
      console.error(chalk.dim('Run `deploylog login` to authenticate.'))
    }
    process.exit(1)
  }

  if (err instanceof Error) {
    console.error(chalk.red(err.message))
    process.exit(1)
  }

  console.error(chalk.red('An unknown error occurred'))
  process.exit(1)
}

program.parse()
