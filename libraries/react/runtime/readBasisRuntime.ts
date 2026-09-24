import type { BasisRuntime } from '../../utilities'
import { parseBasisRuntime } from '../../utilities'

/** DOM id of the runtime facts Basis Server embeds in the SPA shell. */
export const BASIS_RUNTIME_ELEMENT_ID = 'basis-runtime'

/**
 * Read the runtime facts Basis Server embedded in the SPA shell.
 *
 * This is a synchronous read of the server-owned bootstrap document, so the
 * browser never performs an extra startup fetch for identity facts.
 * @param doc - Document to read; defaults to the ambient `document` when present.
 * @returns The embedded runtime facts, or empty facts when absent.
 */
export function readBasisRuntime(doc?: Document | null): BasisRuntime {
  const target = doc ?? (typeof document === 'undefined' ? null : document)
  return parseBasisRuntime(target?.getElementById(BASIS_RUNTIME_ELEMENT_ID)?.textContent ?? null)
}
