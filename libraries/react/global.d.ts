import type { OverlayProvider } from './components/OverlayProvider/OverlayProvider'

declare global {
  interface Window {
    /** Set by `OverlayProvider` while mounted; cleared on unmount. */
    overlayProvider?: OverlayProvider,
  }
}

export { }
