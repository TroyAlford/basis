/**
 * Shared process-execution classification for compliance rules.
 *
 * The direct-spawn rule bans everything except the Basis runner. The
 * application-fixture rule still has to recognize the allowed runner, because
 * `runAsync` is a bounded command runner and is not a substitute for
 * `useApplication`.
 */

import type { ResolvedReference } from './imports'
import { exportPath, fromGlobal, fromSource } from './imports'

const CHILD_PROCESS_EXPORTS: ReadonlySet<string> = new Set([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
])

const BUN_EXPORTS: ReadonlySet<string> = new Set(['$', 'spawn', 'spawnSync'])

const DENO_EXPORTS: ReadonlySet<string> = new Set(['command', 'run'])

const WRAPPER_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  '$': ['$'],
  'cross-spawn': ['', 'spawn', 'spawnSync', 'sync'],
  'execa': ['', '$', '$sync', 'execa', 'execaCommand', 'execaCommandSync', 'execaSync'],
  'shelljs': ['exec'],
  'tinyexec': ['exec', 'x'],
  'zx': ['$'],
}

// The wrapper sources that expose a callable default export.
const DEFAULT_WRAPPERS: ReadonlySet<string> = new Set(['cross-spawn', 'execa', 'tinyexec'])

/**
 * Whether a resolved reference names a direct process-execution API.
 * @param reference The resolved reference.
 * @returns Whether the reference is prohibited by `no-direct-process-spawn`.
 */
export const isProcessExecution = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  const path = exportPath(reference)
  const [name] = path

  if (path.length === 1 && name !== undefined) {
    if (fromGlobal(reference, ['Bun']) && BUN_EXPORTS.has(name)) return true
    if (fromGlobal(reference, ['Deno']) && DENO_EXPORTS.has(name)) return true
    if (fromSource(reference, ['child_process']) && CHILD_PROCESS_EXPORTS.has(name)) return true
  }

  for (const [source, exports] of Object.entries(WRAPPER_EXPORTS)) {
    if (!fromSource(reference, [source])) continue
    if (path.length === 0 && DEFAULT_WRAPPERS.has(source)) return true
    if (path.length === 1 && name !== undefined && exports.includes(name)) return true
  }

  return false
}

/**
 * Whether a resolved reference is the allowed Basis command runner.
 * @param reference The resolved reference.
 * @returns Whether the reference is `run` or `runAsync` from `basis/utilities`.
 */
export const isBasisRunner = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  const path = exportPath(reference)
  return fromSource(reference, ['basis/utilities'])
    && path.length === 1
    && (path[0] === 'run' || path[0] === 'runAsync')
}

/**
 * Describe a process reference for a diagnostic.
 * @param reference The resolved reference.
 * @returns A dotted API name.
 */
export const describeProcess = (reference: ResolvedReference): string => {
  const path = exportPath(reference)
  const origin = reference.origin.kind === 'module'
    ? reference.origin.source.replace(/^node:/, '')
    : reference.origin.name
  return [origin, ...path].filter(part => part.length > 0).join('.')
}
