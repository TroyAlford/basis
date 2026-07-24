import { render } from '../../testing/render'
import { OverlayProvider } from './OverlayProvider'

/** Clears `window.overlayProvider` between overlay tests. */
export async function resetOverlayProvider(): Promise<void> {
  const rendered = await render(<OverlayProvider />)
  rendered.unmount()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}
