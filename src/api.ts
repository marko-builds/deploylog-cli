import { getApiKey, getApiUrl } from './config.js'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('Not authenticated. Run `deploylog login` first.')
  }

  const url = `${getApiUrl()}/api/cli${path}`

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  })

  const json = await res.json()

  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? `Request failed (${res.status})`,
    )
  }

  return json.data as T
}

export interface Project {
  id: string
  name: string
  slug: string
  website_url: string | null
  created_at: string
}

export interface Entry {
  id: string
  title: string
  slug: string
  entry_type: string | null
  version: string | null
  published: boolean
  published_at: string | null
  created_at: string
}

export async function listProjects(): Promise<Project[]> {
  return request('/projects')
}

export async function listEntries(projectSlug: string): Promise<Entry[]> {
  return request(`/projects/${projectSlug}/entries`)
}

export interface CreateEntryInput {
  title: string
  body_markdown: string
  entry_type?: string | null
  version?: string
  publish?: boolean
}

export async function createEntry(projectSlug: string, input: CreateEntryInput): Promise<Entry> {
  return request(`/projects/${projectSlug}/entries`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
