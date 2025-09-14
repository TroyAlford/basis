/**
 * Determines how images should be aligned within a container
 */
export enum Align {
  /** Center both horizontally and vertically */
  Center = 'center',
  /** Align to right edge */
  East = 'right center',
  /** Align to top edge */
  North = 'center top',
  /** Align to top-right corner */
  NorthEast = 'right top',
  /** Align to top-left corner */
  NorthWest = 'left top',
  /** Align to bottom edge */
  South = 'center bottom',
  /** Align to bottom-right corner */
  SouthEast = 'right bottom',
  /** Align to bottom-left corner */
  SouthWest = 'left bottom',
  /** Align to left edge */
  West = 'left center',
}
