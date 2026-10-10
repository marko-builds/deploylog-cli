// Issue 09 smoke run: the BUILT CLI (dist/) with SUDO_USER set and unset.
//
// It covers what no suite test reaches: the exit code the src/index.ts adapter
// sets on a refusal, and the read-only commands (--version, --help, whoami)
// still working under SUDO_USER (index.ts has no seam for them).
//
// Run after a build: npm run build && node issues/09/smoke-sudo.mjs
// Every child runs with its config dir redirected into a fresh temp sandbox,
// and step 0 aborts before any login/logout if conf would not resolve inside
// it, so the real user's stored key is never read or written. The API is a
// local fake server; nothing leaves the machine.
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(ROOT, 'dist', 'index.js')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
if (!existsSync(CLI)) {
  console.error(`No build at ${CLI}: run npm run build first.`)
  process.exit(2)
}

const sandbox = mkdtempSync(join(tmpdir(), 'deploylog-09-smoke-'))
const baseEnv = {
  ...process.env,
  APPDATA: sandbox,
  LOCALAPPDATA: sandbox,
  XDG_CONFIG_HOME: sandbox,
  HOME: sandbox,
  USERPROFILE: sandbox,
  NO_COLOR: '1',
}
delete baseEnv.SUDO_USER
const sudoEnv = { ...baseEnv, SUDO_USER: 'marko' }

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

const seenAuth = []
const server = http.createServer((req, res) => {
  seenAuth.push(`${req.method} ${req.url} ${req.headers.authorization}`)
  if (req.url === '/api/cli/whoami') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        data: {
          organization: { name: 'Smoke Org', slug: 'smoke-org', plan: 'free' },
          api_key: { name: 'smoke', prefix: 'dk_smo', permissions: ['read'], last_used_at: null, created_at: '2026-10-10T00:00:00Z' },
          ai_usage: { used: 0, limit: 10, month_key: '2026-10' },
        },
      }),
    )
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const apiUrl = `http://127.0.0.1:${server.address().port}`

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : `\n    ${detail}`}`)
}

// 0. conf must resolve inside the sandbox, or nothing below may run.
const probe = await run(
  ['--input-type=module', '-e', "import Conf from 'conf'; console.log(new Conf({projectName:'deploylog'}).path)"],
  baseEnv,
)
const storePath = probe.stdout.trim()
const inSandbox = probe.code === 0 && storePath.toLowerCase().startsWith(sandbox.toLowerCase())
check('0 conf store resolves inside the sandbox', inSandbox, `code=${probe.code} path=${storePath} sandbox=${sandbox} ${probe.stderr}`)
if (!inSandbox) {
  server.close()
  process.exit(2)
}
const readStore = () => (existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : {})

let r = await run([CLI, '--version'], sudoEnv)
check(`1 SUDO_USER set: --version works (prints ${VERSION})`, r.code === 0 && r.stdout.trim() === VERSION, JSON.stringify(r))

r = await run([CLI, '--help'], sudoEnv)
check('2 SUDO_USER set: --help works', r.code === 0 && r.stdout.includes('login'), JSON.stringify(r))

// conf writes its schema default (apiUrl) at construction on every CLI start, --version
// included, so the store is compared before/after rather than expected empty.
const storeBefore = JSON.stringify(readStore())
console.log(`    store before step 3: ${storeBefore}`)
r = await run([CLI, 'login', '--key', 'dk_smoke', '--api-url', apiUrl], sudoEnv)
check(
  '3 SUDO_USER set: login refused, exit 1, store unchanged (neither the key nor --api-url written)',
  r.code === 1 &&
    r.stderr.includes('Refusing to run `deploylog login` under sudo') &&
    JSON.stringify(readStore()) === storeBefore &&
    readStore().apiKey === undefined &&
    readStore().apiUrl !== apiUrl,
  JSON.stringify({ ...r, store: readStore() }),
)
console.log(`    stderr: ${r.stderr.trim().replace(/\n/g, '\n            ')}`)

r = await run([CLI, 'login', '--key', 'dk_smoke', '--api-url', apiUrl], baseEnv)
check(
  '4 SUDO_USER unset: login saves (guard silent)',
  r.code === 0 && r.stdout.includes('Authenticated successfully.') && readStore().apiKey === 'dk_smoke' && readStore().apiUrl === apiUrl,
  JSON.stringify({ ...r, store: readStore() }),
)

r = await run([CLI, 'whoami', '--json'], sudoEnv)
let me = null
try {
  me = JSON.parse(r.stdout)
} catch {}
check(
  '5 SUDO_USER set: whoami --json works (read-only)',
  r.code === 0 && me?.organization?.slug === 'smoke-org' && seenAuth.some((s) => s.includes('/api/cli/whoami Bearer dk_smoke')),
  JSON.stringify({ ...r, seenAuth }),
)

r = await run([CLI, 'logout'], sudoEnv)
check(
  '6 SUDO_USER set: logout refused, exit 1, key kept',
  r.code === 1 && r.stderr.includes('Refusing to run `deploylog logout` under sudo') && readStore().apiKey === 'dk_smoke',
  JSON.stringify({ ...r, store: readStore() }),
)

r = await run([CLI, 'logout'], baseEnv)
check(
  '7 SUDO_USER unset: logout clears (guard silent)',
  r.code === 0 && r.stdout.includes('Logged out.') && readStore().apiKey === undefined,
  JSON.stringify({ ...r, store: readStore() }),
)

server.close()
const failed = results.filter((x) => !x.ok).length
console.log(`${results.length - failed}/${results.length} passed; sandbox ${sandbox}`)
process.exit(failed === 0 ? 0 : 1)
