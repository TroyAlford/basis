import { Router } from 'basis/react'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

/**
 * Documentation for {@link OverlayProvider}: the single registration and host layer for
 * {@link Dialog} and {@link Notification}.
 */
export class OverlayProviderDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <h1>OverlayProvider</h1>
        <section>
          <p><code>OverlayProvider</code> is the single registration, update, terminal-transition, callback, and cleanup host for both dialogs and notifications. While it is mounted, <code>window.overlayProvider</code> points at the instance so <code>Dialog</code> and <code>Notification</code> helpers can register work without React context.</p>
          <p>There is no second overlay manager, no global event bus, and no per-kind duplicate dismissal engine. The two kinds share the provider-owned lifecycle while keeping type-specific renderers: dialogs use native modal stacking, focus, and backdrop handling; notifications use independent live regions and timers.</p>
          <p>In a Basis app, <code>Layout</code> extends <code>ApplicationBase</code>, which renders <code>OverlayProvider</code> after your routed layout. You only need to mount it yourself in smaller harnesses or apps that do not use <code>ApplicationBase</code>.</p>
        </section>
        <section>
          <h2>Shared lifecycle</h2>
          <ul>
            <li>Each overlay has a stable id, mutable options, a handle tied to that id, and exactly one terminal removal.</li>
            <li>Updating an overlay re-renders the same mounted row through React reconciliation. It does not close, remount, or change identity solely because its content, title, intent, or buttons changed.</li>
            <li>Pre-terminal guards can veto with <code>false</code>; async guards are awaited before closing. A throw or rejection vetoes, keeps the overlay active, and reports through <code>onError</code>.</li>
            <li>After-hooks run once before the public result settles. Provider teardown is a forced cleanup and cannot hang.</li>
          </ul>
        </section>
        <section>
          <h2>Modal stack</h2>
          <p>The provider keeps a real stack of mounted native dialogs, bottom to top. Only the top dialog receives keyboard and backdrop interactions. A parent dismissal guard can open a nested confirmation without a queued-behind-parent deadlock. Closing a child preserves the mounted parent and restores focus inside it; closing the root restores the original trigger when it still exists. Programmatic terminal requests for a non-topmost dialog return <code>false</code>.</p>
          <p>Notifications render independently of that stack, never take modal focus, and preserve their creation order.</p>
        </section>
        <section>
          <h2>Component docs</h2>
          <ul>
            <li><Router.Link to="/components/dialog">Dialog</Router.Link> — managed handles, <code>open</code>, <code>choice</code>, <code>confirm</code>, <code>editor</code>, lifecycle callbacks, persistent actions, and stacking.</li>
            <li><Router.Link to="/components/notification">Notification</Router.Link> — handle <code>update</code> / async <code>dismiss</code>, shared dismissal hooks, <code>timeout</code>, and <code>Intent</code>.</li>
          </ul>
        </section>
        <section>
          <h2>Mount</h2>
          <p>Outside <code>ApplicationBase</code>, render it once next to your router tree:</p>
          {Code.format(`
            import { OverlayProvider } from 'basis/react'

            export function Root() {
              return (
                <>
                  <AppRoutes />
                  <OverlayProvider />
                </>
              )
            }
          `)}
        </section>
      </>
    )
  }
}
