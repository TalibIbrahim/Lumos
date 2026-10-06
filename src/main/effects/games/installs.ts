import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

/** Reads the Steam install folder from the registry, falling back to the default location. */
export function steamRoot(): string | null {
  if (process.platform !== 'win32') return null
  for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', key.startsWith('HKCU') ? 'SteamPath' : 'InstallPath'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000
      })
      const m = out.match(/REG_SZ\s+(.+)\s*$/m)
      if (m && existsSync(m[1].trim())) return m[1].trim().replace(/\//g, '\\')
    } catch {
      // key missing
    }
  }
  const fallback = 'C:\\Program Files (x86)\\Steam'
  return existsSync(fallback) ? fallback : null
}

/** Parses the "path" entries out of Steam's libraryfolders.vdf. */
export function parseLibraryFolders(vdf: string): string[] {
  const paths: string[] = []
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(vdf)) !== null) {
    paths.push(m[1].replace(/\\\\/g, '\\'))
  }
  return paths
}

export function steamLibraries(): string[] {
  const root = steamRoot()
  if (!root) return []
  const libs = new Set<string>([root])
  const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
  if (existsSync(vdf)) {
    try {
      for (const p of parseLibraryFolders(readFileSync(vdf, 'utf8'))) libs.add(p)
    } catch {
      // unreadable file; keep the root library
    }
  }
  return Array.from(libs).filter((p) => existsSync(p))
}

/** Finds a Steam game folder by its folder name under steamapps/common. */
export function findSteamGame(folderName: string): string[] {
  return steamLibraries()
    .map((lib) => join(lib, 'steamapps', 'common', folderName))
    .filter((p) => existsSync(p))
}

/** Finds Epic Games Store installs whose display name or app name matches. */
export function findEpicGame(matches: (displayName: string, appName: string) => boolean): string[] {
  if (process.platform !== 'win32') return []
  const dir = join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
  if (!existsSync(dir)) return []
  const found: string[] = []
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.item')) continue
      try {
        const item = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        const display = typeof item.DisplayName === 'string' ? item.DisplayName : ''
        const app = typeof item.AppName === 'string' ? item.AppName : ''
        const loc = typeof item.InstallLocation === 'string' ? item.InstallLocation : ''
        if (loc && matches(display, app) && existsSync(loc)) found.push(loc)
      } catch {
        // skip malformed manifest
      }
    }
  } catch {
    // unreadable folder
  }
  return found
}
