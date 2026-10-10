import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

// ci.yml is the only thing that makes a green check on a pull request mean the suite ran
// (manual-check.yml verifies the Manual and runs no tests). These tests fail when the
// pull_request trigger is removed, filtered by branch or path, or limited to activity types
// that leave out opened, synchronize or reopened; when push to main is dropped; when a gate
// step is removed or reordered; and when a job or a gate step gets an `if` or a
// `continue-on-error`. Other edits can still weaken the workflow without failing them.
// They run inside `npm test`, so a local gate run catches such an edit. A pull request runs
// its own copy of ci.yml, so the checks on the pull request that weakens it cannot be relied
// on to catch it.

const GATE = ['npm ci', 'npm run build', 'npm test']
const DEFAULT_PR_TYPES = ['opened', 'synchronize', 'reopened']

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
    expect(on.pull_request?.types ?? DEFAULT_PR_TYPES, 'types').toEqual(expect.arrayContaining(DEFAULT_PR_TYPES))
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

  it('no job and no gate step can be skipped or allowed to fail', () => {
    const { jobs } = readWorkflow()
    for (const [name, job] of Object.entries(jobs)) {
      const gateSteps = job.steps.filter((s) => GATE.includes(s.run?.trim() ?? ''))
      for (const key of ['if', 'continue-on-error']) {
        expect(job, `job ${name} has ${key}`).not.toHaveProperty(key)
        for (const step of gateSteps) expect(step, `${name}: ${step.run} has ${key}`).not.toHaveProperty(key)
      }
    }
  })
})
