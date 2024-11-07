/** License handling options */
export type LicenseOption =
  /** Skip license handling */
  | 'none'
  /** Copy from repository root */
  | 'inherit'
  /** Use local license if present, otherwise inherit */
  | 'auto'
  /** Use a specific license file */
  | string
