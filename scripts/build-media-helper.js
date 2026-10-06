/**
 * Compiles the Windows system media helper with the C# compiler that ships
 * with the .NET Framework on every Windows 10 and 11 installation, so neither
 * the build machine nor the user needs an SDK. On other platforms this is a
 * no-op; the features that depend on the helper report themselves unavailable.
 *
 * Output: resources/media-helper/LumosMediaHelper.exe (packaged as an extra resource)
 */
const { execFileSync } = require('child_process')
const { existsSync, mkdirSync, statSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const source = join(root, 'native', 'media-helper', 'LumosMediaHelper.cs')
const outDir = join(root, 'resources', 'media-helper')
const output = join(outDir, 'LumosMediaHelper.exe')

if (process.platform !== 'win32') {
  console.log('[media-helper] Skipped: only built on Windows')
  process.exit(0)
}

const windir = process.env.WINDIR || 'C:\\Windows'
const frameworkDirs = [
  join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319'),
  join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319')
]
const fw = frameworkDirs.find((d) => existsSync(join(d, 'csc.exe')))
if (!fw) {
  console.error('[media-helper] The .NET Framework C# compiler was not found')
  process.exit(1)
}

if (existsSync(output) && statSync(output).mtimeMs > statSync(source).mtimeMs && !process.argv.includes('--force')) {
  console.log('[media-helper] Up to date')
  process.exit(0)
}

const winmd = join(windir, 'System32', 'WinMetadata')
const refs = [
  join(fw, 'System.Runtime.WindowsRuntime.dll'),
  join(fw, 'System.Runtime.dll'),
  join(fw, 'System.Threading.Tasks.dll'),
  join(fw, 'System.Runtime.InteropServices.WindowsRuntime.dll'),
  join(winmd, 'Windows.Foundation.winmd'),
  join(winmd, 'Windows.Media.winmd'),
  join(winmd, 'Windows.Storage.winmd'),
  join(winmd, 'Windows.Graphics.winmd')
]
for (const r of refs) {
  if (!existsSync(r)) {
    console.error(`[media-helper] Missing reference: ${r}`)
    process.exit(1)
  }
}

mkdirSync(outDir, { recursive: true })
const args = [
  '/nologo',
  '/target:exe',
  '/optimize+',
  '/platform:anycpu',
  `/out:${output}`,
  ...refs.map((r) => `/reference:${r}`),
  source
]
try {
  execFileSync(join(fw, 'csc.exe'), args, { stdio: 'inherit' })
  console.log(`[media-helper] Built ${output}`)
} catch {
  console.error('[media-helper] Compilation failed')
  process.exit(1)
}
