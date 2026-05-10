import * as React from 'react'
import { Button, Notification, Router } from '@basis/react'
import { Code } from '../components/Code'

interface State {
  lastHandle: string | null,
}

/**
 * Documentation for {@link Notification}: static {@link Notification.create}, handle API, and
 * {@link Notification.Intent}.
 */
export class NotificationDocs extends React.Component<object, State> {
  state: State = {
    lastHandle: null,
  }

  showPrimary = () => {
    const handle = Notification.create({
      content: 'Primary intent uses the brand colors on the notification shell; there is no icon.',
      intent: Notification.Intent.Primary,
      timeout: 5_000,
      title: 'Saved',
    })
    this.setState({ lastHandle: handle.id })
  }

  showDanger = () => {
    const handle = Notification.create({
      content: 'Danger intent shows the warning icon and danger styling.',
      intent: Notification.Intent.Danger,
      timeout: 5_000,
      title: 'Save failed',
    })
    this.setState({ lastHandle: handle.id })
  }

  showSuccess = () => {
    const handle = Notification.create({
      content: 'Success intent shows the SquareCheck (checkbox) icon and success styling.',
      intent: Notification.Intent.Success,
      timeout: 5_000,
      title: 'Uploaded',
    })
    this.setState({ lastHandle: handle.id })
  }

  showLifecycleDemo = () => {
    const handle = Notification.create({
      content: 'Starting…',
      intent: Notification.Intent.Primary,
      timeout: null,
      title: 'Working',
    })
    this.setState({ lastHandle: handle.id })
    window.setTimeout(() => {
      handle.update({
        content: 'Done.',
        intent: Notification.Intent.Success,
        timeout: 3_000,
        title: 'Finished',
      })
    }, 1_200)
  }

  render(): React.ReactNode {
    const { lastHandle } = this.state

    return (
      <>
        <h1>Notification</h1>
        <section>
          <p>
            <code>Notification.create</code> enqueues a dismissible row on the{' '}
            <Router.Link to="/components/overlay-provider">OverlayProvider</Router.Link>. The returned handle
            exposes <code>id</code>, <code>update</code>, and <code>dismiss</code> so you can refresh copy or
            remove the note programmatically.
          </p>
          <p>
            Import <code>type {'{'} INotification {'}'}</code> from the same module as <code>Notification</code>{' '}
            for typing partial payloads; it is not re-exported from <code>@basis/react</code>.
          </p>
        </section>
        <section>
          <h2>Intent</h2>
          <p>
            Optional <code>intent</code> on <code>INotification</code> tints the shell and selects a header
            icon where applicable. Values mirror <code>Dialog</code>:
          </p>
          <ul>
            <li><strong>Default</strong>: neutral shell and header.</li>
            <li>
              <strong>Primary</strong>: primary colors; no icon.
            </li>
            <li>
              <strong>Danger</strong>: danger colors; warning icon in the header.
            </li>
            <li>
              <strong>Success</strong>: success colors; SquareCheck (checkbox) icon in the header.
            </li>
          </ul>
        </section>
        <section>
          <h2>Timeout and persistence</h2>
          <p>
            <code>timeout</code> is milliseconds until auto-dismiss, or <code>null</code> to keep the row
            until <code>dismiss</code>. Omitting <code>timeout</code> defaults to <code>null</code> via the
            overlay host.
          </p>
        </section>
        <section>
          <h2>Interactive examples</h2>
          <p>
            <Button onActivate={this.showPrimary}>Primary</Button>{' '}
            <Button onActivate={this.showDanger}>Danger</Button>{' '}
            <Button onActivate={this.showSuccess}>Success</Button>{' '}
            <Button onActivate={this.showLifecycleDemo}>Update after delay</Button>
          </p>
          {lastHandle && (
            <p>
              Last created id: <code>{lastHandle}</code>
            </p>
          )}
        </section>
        <section>
          <h2>Usage</h2>
          {Code.format(`
            import { Notification } from '@basis/react'

            const note = Notification.create({
              title: 'Uploading',
              content: 'Preparing files…',
              intent: Notification.Intent.Primary,
              timeout: null,
            })

            note.update({
              title: 'Uploaded',
              content: 'Files are ready.',
              intent: Notification.Intent.Success,
              timeout: 4000,
            })

            note.dismiss()
          `)}
        </section>
        <section>
          <h2>Related</h2>
          <ul>
            <li>
              <Router.Link to="/components/dialog">Dialog</Router.Link> — modal confirmations with the same{' '}
              <code>Intent</code> enum.
            </li>
            <li>
              <Router.Link to="/components/overlay-provider">OverlayProvider</Router.Link> — host component
              and mounting notes.
            </li>
          </ul>
        </section>
      </>
    )
  }
}
