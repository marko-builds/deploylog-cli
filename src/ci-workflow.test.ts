import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

// ci.yml is the only thing that makes a green check on a pull request mean the suite ran
// (manual-check.yml verifies the Manual and runs no tests). An edit that stops it running
// the gate on pull requests would leave every check green, so these tests fail instead.

interface Step {
  run?: string
}

interface Workflow {
  on: Record<string, Record<string, unknown> | null>
  jobs: Record<string, { steps: Step[] }>
}

function readWorkflow(): Workflow {
  return parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')) as Workflow
}

describe('ci.yml', () => {
  it('runs on every pull request, unfiltered, and on pushes to main', () => {
    const { on } = readWorkflow()
    expect(Object.keys(on)).toContain('pull_request')
    for (const filter of ['branches', 'branches-ignore', 'paths', 'paths-ignore']) {
      expect(on.pull_request ?? {}, filter).not.toHaveProperty(filter)
    }
    expect(on.push?.branches).toContain('main')
  })

  it('every job installs from the lockfile, then builds, then runs the suite', () => {
    const { jobs } = readWorkflow()
    expect(Object.keys(jobs).length).toBeGreaterThan(0)
    for (const [name, job] of Object.entries(jobs)) {
      const runs = job.steps.map((s) => s.run?.trim()).filter((r): r is string => Boolean(r))
      const at = (command: string) => runs.indexOf(command)
      expect(at('npm ci'), name).toBeGreaterThanOrEqual(0)
      expect(at('npm run build'), name).toBeGreaterThan(at('npm ci'))
      expect(at('npm test'), name).toBeGreaterThan(at('npm run build'))
    }
  })
})
