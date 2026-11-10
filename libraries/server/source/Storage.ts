import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * Resolve the installation-owned Basis state directory.
 * @param installation - Application installation root.
 * @returns Absolute `.basis` path.
 */
export function basisDirectory(installation: string): string {
  return join(resolve(installation), '.basis')
}

/**
 * Resolve the managed database state directory.
 * @param installation - Application installation root.
 * @returns Absolute `.basis/database` path.
 */
export function databaseDirectory(installation: string): string {
  return join(basisDirectory(installation), 'database')
}

/**
 * Resolve the default managed backup directory.
 * @param installation - Application installation root.
 * @returns Absolute `.basis/backups` path.
 */
export function backupsDirectory(installation: string): string {
  return join(basisDirectory(installation), 'backups')
}

/**
 * Resolve a path inside the installation-owned Basis state.
 * @param installation - Application installation root.
 * @param segments - Relative path segments.
 * @returns Absolute state path.
 */
export function basisPath(installation: string, ...segments: string[]): string {
  return join(basisDirectory(installation), ...segments)
}

/**
 * Create one private directory if it does not exist.
 * @param directory - Directory path.
 * @param mode - Directory mode.
 * @returns The resolved directory path.
 */
export async function ensureDirectory(directory: string, mode = 0o700): Promise<string> {
  await mkdir(directory, { mode, recursive: true })
  await chmod(directory, mode)
  return directory
}

/**
 * Create the installation and managed-database state directories.
 * @param installation - Application installation root.
 */
export async function ensureDatabaseDirectories(installation: string): Promise<void> {
  await ensureDirectory(basisDirectory(installation))
  await ensureDirectory(databaseDirectory(installation))
  await ensureDirectory(backupsDirectory(installation))
}

/**
 * Write one JSON file atomically with private permissions.
 * @param file - Destination path.
 * @param value - JSON-compatible value.
 * @param mode - File mode.
 */
export async function writeJson(file: string, value: unknown, mode = 0o600): Promise<void> {
  const temporary = `${file}.${randomUUID()}`
  await ensureDirectory(dirname(file))
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode })
  await rename(temporary, file)
}
