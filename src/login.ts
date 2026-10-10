import { setApiKey, setApiUrl, clearConfig, getConfigPath } from './config.js'

export interface LoginOptions {
  key?: string
  apiUrl?: string
}

type SudoRefusal = { kind: 'sudo-not-supported'; message: string }

export type LoginResult =
  | { kind: 'saved'; configPath: string }
  | SudoRefusal
  | { kind: 'invalid-key'; message: string }
  | { kind: 'invalid-url'; message: string }

export type LogoutResult = { kind: 'cleared' } | SudoRefusal

/** Where credentials live: the `conf` store in the running user's config dir. */
export interface CredentialStore {
  setApiKey(key: string): void
  setApiUrl(url: string): void
  clear(): void
  path(): string
}

export interface LoginDeps {
  /**
   * The process the command runs as. Only `env.SUDO_USER` decides a refusal;
   * `getuid` (absent on Windows) is in the type so a test can hand over a
   * root process and prove uid 0 alone refuses nothing (a container running
   * as root is a legitimate user).
   */
  proc: Pick<NodeJS.Process, 'env' | 'getuid'>
  store: CredentialStore
  /** Ask for the key interactively; resolves with what the user typed. */
  promptKey(): Promise<string>
}

export type LogoutDeps = Pick<LoginDeps, 'proc' | 'store'>

const INVALID_KEY = { kind: 'invalid-key', message: 'Invalid API key. Keys start with dk_' } as const

const NPM_PREFIX_DOC =
  'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally'

/** What running the command under sudo would do instead of what the user meant. */
const SUDO_HARM = {
  login:
    'The key would be saved in the config of the user sudo runs as (root, by default), not in yours, so every deploylog command you run without sudo would find no credentials.',
  logout:
    'It would clear the config of the user sudo runs as (root, by default), not yours, so your own key would stay saved.',
} as const

/**
 * `conf` writes to the running user's config dir, so a credential write under
 * sudo lands in root's store and nothing later says so (pnpm 12 refuses the
 * same way: ERR_PNPM_SUDO_NOT_SUPPORTED). SUDO_USER is set under sudo and
 * absent under a real root login or `su`; uid 0 alone is not the signal,
 * because a container running as root is a legitimate user. Every command
 * that writes credentials or global config calls this first; read-only
 * commands never do.
 */
function sudoRefusal(command: keyof typeof SUDO_HARM, proc: LoginDeps['proc']): SudoRefusal | null {
  if (proc.env['SUDO_USER'] === undefined) return null
  return {
    kind: 'sudo-not-supported',
    message:
      `Refusing to run \`deploylog ${command}\` under sudo (SUDO_USER is set). ${SUDO_HARM[command]}\n` +
      `Run \`deploylog ${command}\` again without sudo. If installing deploylog needed sudo, ` +
      `that is an npm prefix problem, not a deploylog one: ${NPM_PREFIX_DOC}`,
  }
}

/** Save an API key (from --key or the prompt) and optionally the API base URL. */
export async function runLogin(
  opts: LoginOptions,
  deps: LoginDeps = defaultLoginDeps,
): Promise<LoginResult> {
  const refusal = sudoRefusal('login', deps.proc)
  if (refusal) return refusal

  if (opts.apiUrl) {
    let parsed: URL
    try {
      parsed = new URL(opts.apiUrl.trim())
    } catch {
      return { kind: 'invalid-url', message: 'Invalid API URL. Provide a valid absolute URL.' }
    }
    // Require http(s) and a real host: a scheme-only value like "https://"
    // parses but would break request URL construction.
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
      return { kind: 'invalid-url', message: 'Invalid API URL. Must use http(s) and include a host.' }
    }
    deps.store.setApiUrl(opts.apiUrl)
  }

  if (opts.key) {
    if (!opts.key.startsWith('dk_')) return INVALID_KEY
    deps.store.setApiKey(opts.key)
    return { kind: 'saved', configPath: deps.store.path() }
  }

  const typed = (await deps.promptKey()).trim()
  if (!typed.startsWith('dk_')) return INVALID_KEY
  deps.store.setApiKey(typed)
  return { kind: 'saved', configPath: deps.store.path() }
}

/** Remove the stored credentials. */
export function runLogout(deps: LogoutDeps = defaultLoginDeps): LogoutResult {
  const refusal = sudoRefusal('logout', deps.proc)
  if (refusal) return refusal

  deps.store.clear()
  return { kind: 'cleared' }
}

async function promptKey(): Promise<string> {
  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const key = await new Promise<string>((resolve) => {
    rl.question('Enter your API key (from Dashboard → API Keys): ', resolve)
  })
  rl.close()
  return key
}

export const defaultLoginDeps: LoginDeps = {
  proc: process,
  store: { setApiKey, setApiUrl, clear: clearConfig, path: getConfigPath },
  promptKey,
}
