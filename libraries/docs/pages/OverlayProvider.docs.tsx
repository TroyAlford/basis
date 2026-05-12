import { Router } from '@basis/react'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

/**
 * Documentation for {@link OverlayProvider}: global host for {@link Dialog} and {@link Notification}.
 */
export class OverlayProviderDocs extends Documentation<Record<string, never>> {
  content() {
    return (
      <>
        <h1>OverlayProvider</h1>
        <section>
          <p>
            <code>OverlayProvider</code> mounts the dialog stack and notification region once at the app edge.
            While it is mounted, <code>window.overlayProvider</code> points at the instance so{' '}
            <code>Dialog.open</code> and <code>Notification.create</code> can enqueue work without React context.
          </p>
          <p>
            In this docs app, <code>Layout</code> extends <code>ApplicationBase</code>, which renders{' '}
            <code>OverlayProvider</code> after your routed layout. You only need to mount it yourself in
            smaller harnesses or apps that do not use <code>ApplicationBase</code>.
          </p>
        </section>
        <section>
          <h2>Component docs</h2>
          <p>
            Product-facing APIs and examples live on dedicated pages:
          </p>
          <ul>
            <li>
              <Router.Link to="/components/dialog">Dialog</Router.Link> — <code>Dialog.open</code>,{' '}
              <code>Dialog.confirm</code>, <code>IDialog</code>, and <code>Intent</code> chrome.
            </li>
            <li>
              <Router.Link to="/components/notification">Notification</Router.Link> —{' '}
              <code>Notification.create</code>, handle <code>update</code> / <code>dismiss</code>,{' '}
              <code>INotification</code>, <code>timeout</code>, and <code>Intent</code>.
            </li>
          </ul>
        </section>
        <section>
          <h2>Mount</h2>
          <p>
            <code>ApplicationBase</code> appends <code>OverlayProvider</code> after <code>layout()</code> inside
            its root content, so dialogs and notifications stay above routed pages. Outside{' '}
            <code>ApplicationBase</code>, render it once next to your router tree:
          </p>
          {Code.format(`
            import { OverlayProvider } from '@basis/react'

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
