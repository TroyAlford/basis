export interface PackageJSON {
  /** Package dependencies */
  dependencies?: Record<string, string>,
  /** Package engines */
  engines?: Record<string, string>,
  /** Package files */
  files?: string[],
  /** Package main */
  main?: string,
  /** Package module */
  module?: string,
  /** Package name */
  name: string,
  /** Package peer dependencies */
  peerDependencies?: Record<string, string>,
  /** Package scripts */
  scripts?: Record<string, string>,
  /** Package types */
  types?: string,
  /** Package version */
  version?: string,
}
