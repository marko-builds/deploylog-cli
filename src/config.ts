import Conf from 'conf'

interface DeployLogConfig {
  apiKey?: string
  apiUrl?: string
}

const config = new Conf<DeployLogConfig>({
  projectName: 'deploylog',
  schema: {
    apiKey: { type: 'string' },
    apiUrl: { type: 'string', default: 'https://deploylog.dev' },
  },
})

export function getApiKey(): string | undefined {
  return config.get('apiKey')
}

export function setApiKey(key: string): void {
  config.set('apiKey', key)
}

export function getApiUrl(): string {
  return config.get('apiUrl') ?? 'https://deploylog.dev'
}

export function setApiUrl(url: string): void {
  config.set('apiUrl', url)
}

export function clearConfig(): void {
  config.clear()
}

export function getConfigPath(): string {
  return config.path
}
