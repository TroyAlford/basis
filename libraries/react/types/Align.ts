/**
 * Determines how images should be aligned within a container
 */
export enum Align {
  /** Center both horizontally and vertically */
  Center = 'center',
  /** Align to right edge */
  East = 'e',
  /** Align to top edge */
  North = 'n',
  /** Align to top-right corner */
  NorthEast = 'ne',
  /** Align to top-left corner */
  NorthWest = 'nw',
  /** Align to bottom edge */
  South = 's',
  /** Align to bottom-right corner */
  SouthEast = 'se',
  /** Align to bottom-left corner */
  SouthWest = 'sw',
  /** Align to left edge */
  West = 'w',
}
