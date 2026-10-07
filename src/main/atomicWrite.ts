import { renameSync, writeFileSync } from 'fs'

/**
 * Writes a file so that a crash or power loss leaves either the old content or the new content, never a
 * truncated file: the data goes to a temporary file next to it, then replaces the original in one rename.
 */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data, 'utf-8')
  renameSync(tmp, path)
}
