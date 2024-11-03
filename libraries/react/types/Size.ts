/**
 * Determines how images should be sized within a container
 */
export enum Size {
  /** Maintain aspect ratio and fit entirely within container */
  Contain = 'contain',
  /** Cover entire container, cropping if necessary */
  Fill = 'fill',
  /** Use image's natural dimensions */
  Natural = 'natural',
}
