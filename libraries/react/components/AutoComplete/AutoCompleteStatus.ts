/**
 * The finite content states AutoComplete renders inside its popup.
 *
 * Shared by the component (which emits `data-state`) and its stylesheet (which
 * selects on `[data-state]`), so the contract has one typed source of truth
 * rather than duplicated string literals in TSX and CSS.
 */
export enum AutoCompleteStatus {
  /** The search completed with an error. */
  Error = 'error',
  /** A search is in flight. */
  Loading = 'loading',
  /** The search completed with no matching options. */
  NotFound = 'not-found',
}
