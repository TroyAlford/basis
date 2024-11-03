import type { Align } from './Align'
import type { Size } from './Size'

/**
 * Configuration object for a single image
 */
export interface ImageConfig {
  /** Optional alignment override for this specific image */
  align?: Align,
  /** Alt text for accessibility */
  altText?: string,
  /** Optional size override for this specific image */
  size?: Size,
  /** URL of the image to display */
  url: string,
}
