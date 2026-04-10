import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

interface ProjectConfig {
  project?: string
  default_type?: string
}

/**
 * Read .deploylog.yml from the current directory (or parents).
 * Returns null if not found.
 */
export function readProjectConfig(): ProjectConfig | null {
  let dir = process.cwd()

  while (true) {
    const filePath = resolve(dir, '.deploylog.yml')
    try {
      const content = readFileSync(filePath, 'utf-8')
      return parse(content) as ProjectConfig
    } catch {
      // File not found, try parent
    }

    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }

  return null
}
