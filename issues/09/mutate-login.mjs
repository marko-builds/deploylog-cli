// Issue 09 mutation harness: one mutation per arm of src/login.test.ts.
//
// Each mutation breaks one rule of the sudo guard in src/login.ts and names the
// test that must go RED for it. A mutation counts as caught only when vitest
// exits 1 AND prints a FAIL line for that test; anything else (exit 0, or a
// failure in some other test or in the file itself) is reported as not caught.
//
// Run from the repo root or anywhere: node issues/09/mutate-login.mjs
// It rewrites src/login.ts in place for each run and restores the original
// bytes afterwards (a finally block, then a byte comparison). Do not interrupt
// it with Ctrl+C: an interrupted run can leave src/login.ts mutated, so check
// `git diff src/login.ts` if it ever stops early.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = join(ROOT, 'src', 'login.ts')
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const ORIGINAL = readFileSync(SRC)

const GUARD = "  if (proc.env['SUDO_USER'] === undefined) return null\n"

/** [old, new] pairs applied in order; each `old` must occur exactly once. */
const MUTATIONS = [
  {
    name: 'login --key under sudo is refused (guard never fires)',
    edits: [[GUARD, '  return null\n']],
    expect: 'runLogin under sudo > refuses --key under sudo (root)',
  },
  {
    name: 'interactive login is refused before the prompt and the --api-url write (guard moved after the prompt)',
    edits: [
      [
        "  const refusal = sudoRefusal('login', deps.proc)\n  if (refusal) return refusal\n\n  if (opts.apiUrl) {",
        "  if (opts.key) {\n    const refusal = sudoRefusal('login', deps.proc)\n    if (refusal) return refusal\n  }\n\n  if (opts.apiUrl) {",
      ],
      [
        '  const typed = (await deps.promptKey()).trim()\n',
        "  const typed = (await deps.promptKey()).trim()\n  const late = sudoRefusal('login', deps.proc)\n  if (late) return late\n",
      ],
    ],
    expect: 'runLogin under sudo > refuses the interactive form',
  },
  {
    name: 'sudo -u to a non-root user is refused (guard also requires uid 0)',
    edits: [[GUARD, "  if (proc.env['SUDO_USER'] === undefined || proc.getuid?.() !== 0) return null\n"]],
    expect: 'runLogin under sudo > refuses --key under sudo -u bob',
  },
  {
    name: 'a process with no getuid is refused (guard requires getuid)',
    edits: [[GUARD, "  if (proc.env['SUDO_USER'] === undefined || proc.getuid === undefined) return null\n"]],
    expect: 'runLogin under sudo > refuses --key under a process with no getuid',
  },
  {
    name: 'an empty SUDO_USER is refused, per the spec (guard is a truthiness check)',
    edits: [[GUARD, "  if (!proc.env['SUDO_USER']) return null\n"]],
    expect: 'runLogin under sudo > refuses --key under SUDO_USER set but empty',
  },
  {
    name: 'login without sudo saves (guard always fires)',
    edits: [[GUARD, '']],
    expect: 'runLogin without sudo (the guard stays silent) > saves a --key and reports the config path',
  },
  {
    name: 'root without SUDO_USER is not refused (uid 0 also refuses)',
    edits: [[GUARD, "  if (proc.env['SUDO_USER'] === undefined && proc.getuid?.() !== 0) return null\n"]],
    expect: 'runLogin without sudo (the guard stays silent) > does not refuse root without SUDO_USER',
  },
  {
    name: 'the refusal names the npm prefix fix (doc link dropped)',
    edits: [['`that is an npm prefix problem, not a deploylog one: ${NPM_PREFIX_DOC}`', '`that is a problem.`']],
    expect: 'runLogin under sudo > names the fix',
  },
  {
    name: 'the refusal says to rerun without sudo (that sentence dropped)',
    edits: [['Run \\`deploylog ${command}\\` again without sudo. ', '']],
    expect: 'runLogin under sudo > names the fix',
  },
  {
    name: 'logout under sudo is refused (logout skips the guard)',
    edits: [["  const refusal = sudoRefusal('logout', deps.proc)\n  if (refusal) return refusal\n", '']],
    expect: 'runLogout > refuses under sudo (root)',
  },
  {
    name: 'logout without sudo clears (logout always refuses)',
    edits: [["  deps.store.clear()\n  return { kind: 'cleared' }\n", "  return { kind: 'sudo-not-supported', message: 'x' }\n"]],
    expect: 'runLogout > clears the store without sudo',
  },
]

function runTests() {
  const res = spawnSync(process.execPath, [VITEST, 'run', 'src/login.test.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  return { code: res.status, out: `${res.stdout}${res.stderr}` }
}

const failLines = (out) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('FAIL'))

const results = []
try {
  for (const m of MUTATIONS) {
    let text = ORIGINAL.toString('utf8')
    for (const [from, to] of m.edits) {
      const count = text.split(from).length - 1
      if (count !== 1) throw new Error(`anchor found ${count} times, expected 1: ${m.name}\n  ${JSON.stringify(from)}`)
      text = text.replace(from, () => to)
    }
    if (text === ORIGINAL.toString('utf8')) throw new Error(`mutation changed nothing: ${m.name}`)
    writeFileSync(SRC, text, 'utf8')
    const { code, out } = runTests()
    const fails = failLines(out)
    let verdict = 'NOT CAUGHT'
    if (code === 1 && fails.some((l) => l.includes(m.expect))) verdict = 'RED'
    else if (code === 0) verdict = 'SURVIVED'
    results.push({ ...m, code, verdict, fails })
  }
} finally {
  writeFileSync(SRC, ORIGINAL)
}

if (!readFileSync(SRC).equals(ORIGINAL)) {
  console.error('src/login.ts was NOT restored to its original bytes')
  process.exit(2)
}

for (const r of results) {
  console.log(`[${r.verdict}] exit=${r.code} :: ${r.name}`)
  console.log(`      expects FAIL on: ${r.expect}`)
  for (const l of r.fails) console.log(`      ${l}`)
}

const clean = runTests()
const summary = clean.out.split('\n').filter((l) => l.includes('Tests ')).map((l) => l.trim())
console.log(`restored run: exit=${clean.code} ${JSON.stringify(summary)}`)
const red = results.filter((r) => r.verdict === 'RED').length
console.log(`${red} of ${results.length} mutations caught`)
process.exit(red === results.length && clean.code === 0 ? 0 : 1)
