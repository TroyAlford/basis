import * as React from 'react'
import { Button, Dialog, Notification, OverlayProvider } from '@basis/react'
import { Code } from '../components/Code'

export class OverlayProviderDocs extends React.Component {
  openDialog = async () => {
    await Dialog.confirm({
      confirmLabel: 'Continue',
      content: 'Dialogs render through the application overlay host.',
      title: 'Confirm action',
    })
  }

  createNotification = () => {
    Notification.create({
      content: 'The notification can be updated or dismissed through its handle.',
      status: Notification.Status.Success,
      timeout: 4_000,
      title: 'Saved',
    })
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>OverlayProvider</h1>
        <section>
          <p>
            OverlayProvider is the host for context-safe dialogs and notifications. ApplicationBase
            renders it automatically inside the application context provider and after the normal
            layout.
          </p>
          <p>
            Mount <code>&lt;OverlayProvider /&gt;</code> manually only when using the overlay APIs
            outside ApplicationBase (this docs page mounts one at the end of the tree so the
            examples work).
          </p>
        </section>
        <section>
          <h3>Dialog</h3>
          <Button onActivate={this.openDialog}>Open dialog</Button>
          {Code.format(`
            import { Dialog } from '@basis/react'

            const result = await Dialog.open({
              title: 'Delete item',
              content: 'This cannot be undone.',
              cancelValue: false,
              buttons: [
                { label: 'Cancel', value: false },
                { intent: Dialog.Intent.Danger, label: 'Delete', value: true },
              ],
            })

            const confirmed = await Dialog.confirm({
              title: 'Continue?',
              content: 'Confirm this action.',
            })
          `)}
        </section>
        <section>
          <h3>Notification</h3>
          <Button onActivate={this.createNotification}>Create notification</Button>
          {Code.format(`
            import { Notification } from '@basis/react'

            const note = Notification.create({
              title: 'Uploading',
              content: 'Preparing files...',
              status: Notification.Status.Loading,
              timeout: null,
            })

            note.update({
              title: 'Uploaded',
              content: 'Files are ready.',
              status: Notification.Status.Success,
              timeout: 4000,
            })

            note.dismiss()
          `)}
        </section>
        <section>
          <h3>Types</h3>
          <p>
            Request and queued-row types live next to their components: import{' '}
            <code>DialogRequest</code>, <code>DialogButton</code>, and <code>DialogQueued</code> from
            the same module as <code>Dialog</code>; import <code>NotificationRequest</code>,{' '}
            <code>NotificationHandle</code>, and <code>NotificationQueued</code> from the same module
            as <code>Notification</code>. Button intents are <code>DialogIntent</code> values (also
            exposed as <code>Dialog.Intent</code>). Notification severity uses{' '}
            <code>NotificationStatus</code> (also <code>Notification.Status</code>).
          </p>
        </section>
        <OverlayProvider />
      </>
    )
  }
}
