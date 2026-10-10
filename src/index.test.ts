import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// index.ts is the adapter and has no exports: it builds the program and calls
// `program.parse()` on import. These tests set argv, import it fresh, and read
// the exit status it leaves behind. The boundaries are mocked so an import
// touches no config file, no network and no git.

const runManualVerify = vi.hoisted(() => vi.fn())
const listEntries = vi.hoisted(() => vi.fn())

vi.mock('./config.js', () => ({
  getApiKey: () => 'dk_test',
  getApiUrl: () => 'https://deploylog.test',
  setApiKey: () => {},
  setApiUrl: () => {},
  getConfigPath: () => 'deploylog-test-config.json',
  clearConfig: () => {},
}))
vi.mock('./project-config.js', () => ({ readProjectConfig: () => null }))
vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  listEntries,
}))
vi.mock('./manual-verify.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./manual-verify.js')>()),
  runManualVerify,
}))

const argv = process.argv
let exit: MockInstance
let stderr: MockInstance

beforeEach(() => {
  // Recorded, not thrown: a call is the failure this file exists to catch.
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = undefined
  process.argv = argv
  runManualVerify.mockReset()
  listEntries.mockReset()
  vi.restoreAllMocks()
})

async function runCli(...args: string[]): Promise<void> {
  process.argv = ['node', 'deploylog', ...args]
  vi.resetModules()
  await import('./index.js')
  // Commander does not await an async action; let it settle.
  await new Promise((resolve) => setImmediate(resolve))
}

const verified = (exitCode: number) => ({
  kind: 'verified',
  report: {},
  verdict: {},
  exitCode,
})

describe('manual verify sets the exit code and returns (issue 14)', () => {
  it('drift exits 1 through process.exitCode, never process.exit', async () => {
    runManualVerify.mockResolvedValue(verified(1))
    await runCli('manual', 'verify', '--project', 'demo')
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('"could not vouch" keeps its own code, 2, under --json too', async () => {
    runManualVerify.mockResolvedValue(verified(2))
    await runCli('manual', 'verify', '--project', 'demo', '--fail-on', 'any', '--json')
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('a clean run leaves the exit status at 0', async () => {
    runManualVerify.mockResolvedValue(verified(0))
    await runCli('manual', 'verify', '--project', 'demo')
    expect(runManualVerify).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('a typed refusal exits 1', async () => {
    runManualVerify.mockResolvedValue({ kind: 'not-found', message: 'No manual for project demo.' })
    await runCli('manual', 'verify', '--project', 'demo')
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('No manual for project demo.'))
  })

  it('a thrown request error exits 1 with the JSON envelope on stderr', async () => {
    runManualVerify.mockRejectedValue(new Error('socket hang up'))
    await runCli('manual', 'verify', '--project', 'demo', '--json')
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith(
      JSON.stringify({ error: { code: 'ERROR', message: 'socket hang up' } }),
    )
  })

  it('an invalid --fail-on exits 1 and stops before any request', async () => {
    await runCli('manual', 'verify', '--project', 'demo', '--fail-on', 'sometimes')
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(runManualVerify).not.toHaveBeenCalled()
  })
})

describe('the other commands stop the same way', () => {
  it('list with conflicting flags exits 1 and sends nothing', async () => {
    await runCli('list', '--project', 'demo', '--drafts', '--published')
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(listEntries).not.toHaveBeenCalled()
  })

  it('list with no project anywhere exits 1 and sends nothing', async () => {
    await runCli('list')
    expect(exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(listEntries).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('No project specified.'))
  })
})

/**
 * Line numbers of every way a module reaches `process.exit`: a property access
 * (`process.exit`, `globalThis.process.exit`), an element access with a literal
 * key, a destructure out of `process`, or a named import from `node:process`.
 * `process.exitCode` is a different name and never matches.
 */
function processExitUses(source: string): number[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true)
  const isProcess = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && node.text === 'process') ||
    (ts.isPropertyAccessExpression(node) && node.name.text === 'process')
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    const hit =
      (ts.isPropertyAccessExpression(node) && isProcess(node.expression) && node.name.text === 'exit') ||
      (ts.isElementAccessExpression(node) &&
        isProcess(node.expression) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'exit') ||
      (ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        isProcess(node.initializer) &&
        ts.isObjectBindingPattern(node.name) &&
        node.name.elements.some((e) => (e.propertyName ?? e.name).getText(file) === 'exit')) ||
      (ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        /^(node:)?process$/.test(node.moduleSpecifier.text) &&
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some(
          (e) => (e.propertyName ?? e.name).text === 'exit',
        ))
    if (hit) lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return lines
}

describe('no module calls process.exit (issue 14)', () => {
  it('finds every spelling it claims to, and not process.exitCode', () => {
    expect(processExitUses('process.exit(1)')).toEqual([1])
    expect(processExitUses('globalThis.process.exit(2)')).toEqual([1])
    expect(processExitUses("process['exit'](1)")).toEqual([1])
    expect(processExitUses('const { exit } = process\nexit(1)')).toEqual([1])
    expect(processExitUses("import { exit as quit } from 'node:process'")).toEqual([1])
    expect(processExitUses('process.exitCode = 1\nconst code = process.exitCode\nrl.exit()')).toEqual([])
  })

  it('src/ ships none', () => {
    // On Windows (Node 24) process.exit() while a fetch's TLS socket is still
    // closing aborts in libuv and the shell sees 127 instead of the code.
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const modules = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'),
    )
    expect(modules).toContain('index.ts')
    const found = modules.flatMap((name) =>
      processExitUses(readFileSync(`${dir}${name}`, 'utf8')).map((line) => `${name}:${line}`),
    )
    expect(found).toEqual([])
  })
})
