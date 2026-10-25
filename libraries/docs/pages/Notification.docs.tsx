import { Button, Notification, Router } from 'basis/react'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

interface State {
  lastHandle: string | null,
}

/**
 * Documentation for {@link Notification}: static {@link Notification.create}, handle API,
 * shared dismissal lifecycle, timeout behavior, and {@link Notification.Intent}.
 */
export class NotificationDocs extends DocumentationPage<State> {
  static override defaultProps = {
    ...DocumentationPage.defaultProps,
    initialValue: {
      lastHandle: null as string | null,
    },
  }

  showPrimary = () => {
    const handle = Notification.create({
      content: 'Primary intent uses the brand colors on the notification shell with a text-only header.',
      intent: Notification.Intent.Primary,
      timeout: 5_000,
      title: 'Saved',
    })
    void this.setState({ current: { ...this.current, lastHandle: handle.id } })
  }

  showDanger = () => {
    const handle = Notification.create({
      content: 'Danger intent shows the warning icon and danger styling.',
      intent: Notification.Intent.Danger,
      timeout: 5_000,
      title: 'Save failed',
    })
    void this.setState({ current: { ...this.current, lastHandle: handle.id } })
  }

  showSuccess = () => {
    const handle = Notification.create({
      content: 'Success intent shows the SquareCheck (checkbox) icon and success styling.',
      intent: Notification.Intent.Success,
      timeout: 5_000,
      title: 'Uploaded',
    })
    void this.setState({ current: { ...this.current, lastHandle: handle.id } })
  }

  showLifecycleDemo = () => {
    const handle = Notification.create({
      content: 'Starting…',
      intent: Notification.Intent.Primary,
      timeout: null,
      title: 'Working',
    })
    void this.setState({ current: { ...this.current, lastHandle: handle.id } })
    window.setTimeout(() => {
      handle.update({
        content: 'Done.',
        intent: Notification.Intent.Success,
        timeout: 3_000,
        title: 'Finished',
      })
    }, 1_200)
  }

  showGuarded = () => {
    const handle = Notification.create({
      content: 'This row refuses one timer dismissal, then allows the next explicit timeout.',
      onDismissed: () => {
        void this.setState({ current: { ...this.current, lastHandle: `${handle.id} (dismissed)` } })
      },
      onDismissing: () => window.confirm('Dismiss this notification?'),
      timeout: 5_000,
      title: 'Guarded',
    })
    void this.setState({ current: { ...this.current, lastHandle: handle.id } })
  }

  content() {
    const { lastHandle } = this.current

    return (
      <>
        <h1>Notification</h1>
        <section>
          <p><code>Notification.create</code> registers a dismissible row on the <Router.Link to="/components/overlay-provider">OverlayProvider</Router.Link>. The returned handle exposes <code>id</code>, <code>update</code>, and an async <code>dismiss</code> so you can refresh copy or remove the note programmatically.</p>
          <p>Notifications and <Router.Link to="/components/dialog">Dialog</Router.Link> share one provider-owned registration, update, terminal-transition, callback, and cleanup lifecycle. Notifications remain nonmodal: they render independently of the dialog stack, preserve their creation order, and expose id, update, and async dismiss through their handle.</p>
          <p>Import <code>type {'{'} INotification {'}'}</code> or <code>type {'{'} NotificationHandle {'}'}</code> from the same module as <code>Notification</code> for typing partial payloads and handles; the package entrypoint exposes the component, while these supporting types live alongside it.</p>
        </section>
        <section>
          <h2>Handle</h2>
          {Code.format(`
            interface NotificationHandle {
              readonly id: string
              update(update: Partial<INotification>): void
              dismiss(): Promise<boolean>
            }
          `)}
          <ul>
            <li><code>update</code> patches only supplied fields on the same mounted row. Updates target the mounted row, which is gone once the notification dismisses.</li>
            <li><code>dismiss()</code> runs the same shared dismissal guard as the close control and timer expiry. It resolves <code>true</code> when dismissal was accepted, <code>false</code> when vetoed, and rejects if a guard throws.</li>
            <li>Notifications provide a dismissal lifecycle: their handle exposes <code>id</code>, <code>update</code>, and async <code>dismiss</code>, with results reported through the dismissal hooks.</li>
          </ul>
        </section>
        <section>
          <h2>Intent</h2>
          <p>Optional <code>intent</code> on <code>INotification</code> tints the shell and selects a header icon where applicable. Omitting <code>intent</code> defaults to <code>Default</code>; omitting <code>icon</code> lets the notification choose the icon from the intent. Values mirror <code>Dialog</code>:</p>
          <ul>
            <li><strong>Default</strong>: neutral shell and header.</li>
            <li><strong>Primary</strong>: primary colors; the header uses text only.</li>
            <li><strong>Danger</strong>: danger colors; filled warning icon in the header.</li>
            <li><strong>Success</strong>: success colors; filled SquareCheck (checkbox) icon in the header.</li>
          </ul>
        </section>
        <section>
          <h2>Timeout and persistence</h2>
          <p><code>timeout</code> is milliseconds until auto-dismiss, or <code>null</code> to keep the row until dismissed. Omitting <code>timeout</code> defaults to <code>null</code> via the overlay host.</p>
          <ul>
            <li>Updating <code>title</code>, <code>content</code>, <code>intent</code>, or <code>icon</code> keeps the timer's original deadline.</li>
            <li>Explicitly updating <code>timeout</code> cancels and rearms the timer from the time of the update; <code>null</code> clears the timer and keeps the row visible until dismissed.</li>
            <li>A vetoed timeout is consumed when it fires; supplying a new <code>timeout</code> value arms a fresh timer.</li>
            <li>Timer expiry, the close control, and <code>dismiss()</code> all route through the same argument-free <code>onDismissing</code> / <code>onDismissed</code> lifecycle.</li>
          </ul>
        </section>
        <section>
          <h2>Interactive examples</h2>
          <p>
            <Button onActivate={this.showPrimary}>Primary</Button>{' '}
            <Button onActivate={this.showDanger}>Danger</Button>{' '}
            <Button onActivate={this.showSuccess}>Success</Button>{' '}
            <Button onActivate={this.showLifecycleDemo}>Update after delay</Button>{' '}
            <Button onActivate={this.showGuarded}>Guarded dismissal</Button>
          </p>
          {lastHandle && (
            <p>Last created id: <code>{lastHandle}</code></p>
          )}
        </section>
        <section>
          <h2>Usage</h2>
          {Code.format(`
            import { Notification } from 'basis/react'

            const note = Notification.create({
              title: 'Uploading',
              content: 'Preparing files…',
              intent: Notification.Intent.Primary,
              timeout: null,
              onDismissing: () => canClose(), // false vetoes an argument-free hook
              onDismissed: () => console.log('closed'),
            })

            note.update({
              title: 'Uploaded',
              content: 'Files are ready.',
              intent: Notification.Intent.Success,
              timeout: 4000,
            })

            const dismissed = await note.dismiss()
          `)}
        </section>
        <section>
          <h2>Related</h2>
          <ul>
            <li><Router.Link to="/components/dialog">Dialog</Router.Link> — managed modal handles with the same <code>Intent</code> enum.</li>
            <li><Router.Link to="/components/overlay-provider">OverlayProvider</Router.Link> — host component and mounting notes.</li>
          </ul>
        </section>
      </>
    )
  }
}
