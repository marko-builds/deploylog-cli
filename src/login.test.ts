import { describe, expect, it, vi } from 'vitest'
import { runLogin, runLogout, type LoginDeps } from './login.js'

/**
 * A fully-stubbed LoginDeps; override per-test. The default process has no
 * SUDO_USER and no getuid, which is also what a Windows process looks like.
 */
function makeDeps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    proc: over.proc ?? { env: {} },
    store: over.store ?? {
      setApiKey: vi.fn(),
      setApiUrl: vi.fn(),
      clear: vi.fn(),
      path: () => '/home/marko/.config/deploylog-nodejs/config.json',
    },
    promptKey: over.promptKey ?? vi.fn().mockResolvedValue('dk_typed'),
  }
}

const UNDER_SUDO = { env: { SUDO_USER: 'marko' }, getuid: () => 0 }

describe('runLogin under sudo', () => {
  it('refuses with a typed refusal and writes nothing', async () => {
    const deps = makeDeps({ proc: UNDER_SUDO })
    const res = await runLogin({ key: 'dk_abc', apiUrl: 'https://deploylog.dev' }, deps)

    expect(res.kind).toBe('sudo-not-supported')
    expect(deps.store.setApiKey).not.toHaveBeenCalled()
    expect(deps.store.setApiUrl).not.toHaveBeenCalled()
    expect(deps.promptKey).not.toHaveBeenCalled()
  })

  it('names the fix: rerun without sudo, and an install that needed root is an npm prefix problem', async () => {
    const res = await runLogin({ key: 'dk_abc' }, makeDeps({ proc: UNDER_SUDO }))

    if (res.kind !== 'sudo-not-supported') throw new Error(`expected a refusal, got ${res.kind}`)
    expect(res.message).toContain('`deploylog login`')
    expect(res.message).toContain('without sudo')
    expect(res.message).toContain('npm prefix')
    expect(res.message).toContain(
      'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally',
    )
  })
})

describe('runLogin without sudo (the guard stays silent)', () => {
  it('does not refuse root without SUDO_USER (a container running as root)', async () => {
    const deps = makeDeps({ proc: { env: {}, getuid: () => 0 } })
    const res = await runLogin({ key: 'dk_abc' }, deps)

    expect(res.kind).toBe('saved')
    expect(deps.store.setApiKey).toHaveBeenCalledWith('dk_abc')
  })

  it('saves a --key and reports the config path', async () => {
    const deps = makeDeps()
    const res = await runLogin({ key: 'dk_abc' }, deps)

    expect(res).toEqual({
      kind: 'saved',
      configPath: '/home/marko/.config/deploylog-nodejs/config.json',
    })
    expect(deps.store.setApiKey).toHaveBeenCalledWith('dk_abc')
    expect(deps.promptKey).not.toHaveBeenCalled()
  })

  it('refuses a --key that does not start with dk_ and saves nothing', async () => {
    const deps = makeDeps()
    const res = await runLogin({ key: 'sk_live_abc' }, deps)

    expect(res).toEqual({ kind: 'invalid-key', message: 'Invalid API key. Keys start with dk_' })
    expect(deps.store.setApiKey).not.toHaveBeenCalled()
  })

  it('saves --api-url as given (the store normalizes it) alongside the key', async () => {
    const deps = makeDeps()
    const res = await runLogin({ key: 'dk_abc', apiUrl: ' http://localhost:3000/ ' }, deps)

    expect(res.kind).toBe('saved')
    expect(deps.store.setApiUrl).toHaveBeenCalledWith(' http://localhost:3000/ ')
  })

  it('refuses an --api-url that does not parse and saves nothing', async () => {
    const deps = makeDeps()
    const res = await runLogin({ key: 'dk_abc', apiUrl: 'not a url' }, deps)

    expect(res).toEqual({
      kind: 'invalid-url',
      message: 'Invalid API URL. Provide a valid absolute URL.',
    })
    expect(deps.store.setApiUrl).not.toHaveBeenCalled()
    expect(deps.store.setApiKey).not.toHaveBeenCalled()
  })

  it('refuses an --api-url that parses but is not http(s) with a host', async () => {
    const deps = makeDeps()
    const res = await runLogin({ key: 'dk_abc', apiUrl: 'ftp://deploylog.dev' }, deps)

    expect(res).toEqual({
      kind: 'invalid-url',
      message: 'Invalid API URL. Must use http(s) and include a host.',
    })
    expect(deps.store.setApiUrl).not.toHaveBeenCalled()
    expect(deps.store.setApiKey).not.toHaveBeenCalled()
  })

  it('prompts for the key when --key is absent and saves it trimmed', async () => {
    const deps = makeDeps({ promptKey: vi.fn().mockResolvedValue('  dk_typed \n') })
    const res = await runLogin({}, deps)

    expect(deps.promptKey).toHaveBeenCalledOnce()
    expect(res.kind).toBe('saved')
    expect(deps.store.setApiKey).toHaveBeenCalledWith('dk_typed')
  })

  it('refuses a prompted key that does not start with dk_', async () => {
    const deps = makeDeps({ promptKey: vi.fn().mockResolvedValue('hunter2') })
    const res = await runLogin({}, deps)

    expect(res).toEqual({ kind: 'invalid-key', message: 'Invalid API key. Keys start with dk_' })
    expect(deps.store.setApiKey).not.toHaveBeenCalled()
  })
})

describe('runLogout', () => {
  it('refuses under sudo, clears nothing, and names the fix', () => {
    const deps = makeDeps({ proc: UNDER_SUDO })
    const res = runLogout(deps)

    if (res.kind !== 'sudo-not-supported') throw new Error(`expected a refusal, got ${res.kind}`)
    expect(res.message).toContain('`deploylog logout`')
    expect(res.message).toContain('without sudo')
    expect(deps.store.clear).not.toHaveBeenCalled()
  })

  it('clears the store without sudo (the guard stays silent)', () => {
    const deps = makeDeps()
    const res = runLogout(deps)

    expect(res).toEqual({ kind: 'cleared' })
    expect(deps.store.clear).toHaveBeenCalledOnce()
  })

  it('does not refuse root without SUDO_USER (a container running as root)', () => {
    const deps = makeDeps({ proc: { env: {}, getuid: () => 0 } })
    const res = runLogout(deps)

    expect(res).toEqual({ kind: 'cleared' })
    expect(deps.store.clear).toHaveBeenCalledOnce()
  })
})
