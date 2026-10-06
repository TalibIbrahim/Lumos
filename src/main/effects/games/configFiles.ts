import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { execFile } from 'child_process'

const BACKUP_SUFFIX = '.lumos-backup'

function encodePs(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * Runs file operations in an elevated PowerShell after a Windows consent
 * prompt. Used only when a game folder is not writable by the user, and only
 * for actions the user has asked for.
 */
function runElevated(script: string): Promise<void> {
  const inner = encodePs(`$ErrorActionPreference = 'Stop'; ${script}`)
  const outer =
    `$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${inner}'; exit $p.ExitCode`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(outer)],
      { windowsHide: true, timeout: 120000 },
      (err) => (err ? reject(new Error('Windows did not allow the change')) : resolve())
    )
  })
}

function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EACCES'
}

export function backupPathFor(file: string): string {
  return `${file}${BACKUP_SUFFIX}`
}

export interface WriteResult {
  backedUp: boolean
  elevated: boolean
}

/**
 * Writes a game config file. Before the first change, the original is copied
 * next to it with a .lumos-backup suffix (and into Lumos's own data folder),
 * so the change can be reverted. Falls back to an elevated copy when the game
 * folder is protected.
 */
export async function writeGameConfig(file: string, content: string, backupDir: string): Promise<WriteResult> {
  const backup = backupPathFor(file)
  const hadOriginal = existsSync(file)
  const needBackup = hadOriginal && !existsSync(backup)
  if (hadOriginal) {
    try {
      mkdirSync(backupDir, { recursive: true })
      const local = join(backupDir, `${basename(dirname(dirname(file)))}-${basename(file)}`)
      if (!existsSync(local)) copyFileSync(file, local)
    } catch {
      // The side-by-side backup below is the one revert uses
    }
  }

  try {
    if (needBackup) copyFileSync(file, backup)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf8')
    return { backedUp: needBackup, elevated: false }
  } catch (err) {
    if (!isPermissionError(err) || process.platform !== 'win32') throw err
  }

  const staged = join(tmpdir(), `lumos-${Date.now()}-${basename(file)}`)
  writeFileSync(staged, content, 'utf8')
  try {
    const steps = [
      needBackup ? `Copy-Item -LiteralPath ${psQuote(file)} -Destination ${psQuote(backup)} -Force` : '',
      `New-Item -ItemType Directory -Force -Path ${psQuote(dirname(file))} | Out-Null`,
      `Copy-Item -LiteralPath ${psQuote(staged)} -Destination ${psQuote(file)} -Force`
    ].filter(Boolean)
    await runElevated(steps.join('; '))
  } finally {
    try {
      unlinkSync(staged)
    } catch {
      // temp file already gone
    }
  }
  return { backedUp: needBackup, elevated: true }
}

/** Restores the backup made before the first change, or removes a file Lumos created. */
export async function revertGameConfig(file: string, createdByLumos: boolean): Promise<'restored' | 'removed' | 'nothing'> {
  const backup = backupPathFor(file)
  const action: 'restored' | 'removed' | 'nothing' = existsSync(backup)
    ? 'restored'
    : createdByLumos && existsSync(file)
      ? 'removed'
      : 'nothing'
  if (action === 'nothing') return action

  try {
    if (action === 'restored') {
      copyFileSync(backup, file)
      unlinkSync(backup)
    } else {
      unlinkSync(file)
    }
    return action
  } catch (err) {
    if (!isPermissionError(err) || process.platform !== 'win32') throw err
  }
  const script =
    action === 'restored'
      ? `Copy-Item -LiteralPath ${psQuote(backup)} -Destination ${psQuote(file)} -Force; Remove-Item -LiteralPath ${psQuote(backup)} -Force`
      : `Remove-Item -LiteralPath ${psQuote(file)} -Force`
  await runElevated(script)
  return action
}

export function readTextIfExists(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  } catch {
    return null
  }
}
