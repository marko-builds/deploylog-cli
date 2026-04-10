#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { setApiKey, getApiKey, setApiUrl, getConfigPath, clearConfig } from './config.js'
import { listProjects, listEntries, createEntry, ApiError } from './api.js'
import { readProjectConfig } from './project-config.js'

const program = new Command()

program
  .name('deploylog')
  .description('Push changelog entries from the terminal')
  .version('0.1.0')

// ─── login ──────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with an API key')
  .option('--key <key>', 'API key (starts with dk_)')
  .option('--api-url <url>', 'API base URL (default: https://deploylog.dev)')
  .action(async (opts: { key?: string; apiUrl?: string }) => {
    if (opts.apiUrl) {
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
  .requiredOption('-t, --title <title>', 'Entry title')
  .requiredOption('-b, --body <markdown>', 'Entry body (Markdown)')
  .option('-p, --project <slug>', 'Project slug (or set in .deploylog.yml)')
  .option('--type <type>', 'Entry type: feature, fix, improvement, breaking, announcement')
  .option('--version <version>', 'Semver version (e.g. 1.2.3)')
  .option('--publish', 'Publish immediately (default: draft)')
  .option('--draft', 'Save as draft (default)')
  .action(async (opts: {
    title: string
    body: string
    project?: string
    type?: string
    version?: string
    publish?: boolean
    draft?: boolean
  }) => {
    try {
      const slug = resolveProject(opts.project)
      const projectConfig = readProjectConfig()

      const entry = await createEntry(slug, {
        title: opts.title,
        body_markdown: opts.body,
        entry_type: opts.type ?? projectConfig?.default_type ?? null,
        version: opts.version,
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
