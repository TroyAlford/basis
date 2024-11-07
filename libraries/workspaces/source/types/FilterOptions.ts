/** Filter options for workspace commands */
export interface FilterOptions {
  /** Exclusion patterns */
  not: string[],
  /** Inclusion patterns */
  only: string[],
}
