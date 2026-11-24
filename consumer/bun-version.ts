/**
 * The canonical Bun compatibility surface used by the Basis CLI, installer,
 * doctor, and Server startup gate.
 *
 * Keep the implementation in the utilities workspace so every consumer entry
 * point reads the same minimums and prerelease policy.
 */
export {
  APPROVED_BUN_SERVER_COMMIT,
  APPROVED_BUN_SERVER_PACKAGE,
  APPROVED_BUN_SERVER_REVISION,
  assertBasisServerCompatible,
  basisServerUnsupportedReason,
  bunCheckUnsupportedReason,
  currentBunRuntime,
  MINIMUM_BUN_FOR_CHECK,
  MINIMUM_BUN_FOR_SERVER,
  parseBunVersion,
  supportsBasisServer,
  supportsBunCheck,
} from '../libraries/utilities/functions/BunRuntime'
export type { BunRuntimeInfo, ParsedVersion } from '../libraries/utilities/functions/BunRuntime'
