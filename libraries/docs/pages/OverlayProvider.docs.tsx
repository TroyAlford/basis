import * as React from 'react'
import { Button, Dialog, Notification } from '@basis/react'
import { Code } from '../components/Code'

export class OverlayProviderDocs extends React.Component {
  openDialog = async () => {
    await Dialog.confirm({
      content: 'Dialogs render through the application overlay host.',
      labelConfirm: 'Continue',
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
            OverlayProvider is the host for context-safe dialogs and notifications. This documentation{' '}
            <code>Layout</code> extends <code>ApplicationBase</code>, which mounts{' '}
            <code>OverlayProvider</code> automatically after your layout so <code>Dialog.open</code> and{' '}
            <code>Notification.create</code> work on every page.
          </p>
          <p>
            Mount <code>&lt;OverlayProvider /&gt;</code> yourself only when using those APIs outside{' '}
            <code>ApplicationBase</code> (for example a small example or test harness).
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
            Dialog and notification <strong>payload</strong> shapes are <code>IDialog</code> and{' '}
            <code>INotification</code> (import <code>type</code> from the same modules as{' '}
            <code>Dialog</code> / <code>Notification</code>; they are not re-exported from{' '}
            <code>@basis/react</code>). Examples: <code>Partial&lt;IDialog&lt;T&gt;&gt;</code> for{' '}
            <code>Dialog.open</code>, or <code>{'INotification & { id: string }'}</code> for queued rows.
            Return types for <code>Notification.create</code> follow{' '}
            <code>OverlayProvider.createNotification</code> (hover or use{' '}
            <code>ReturnType&lt;OverlayProvider['createNotification']&gt;</code> on an instance type).
            Button intents are <code>Intent</code> (re-exported as <code>DialogIntent</code>; also{' '}
            <code>Dialog.Intent</code>). Notification severity is <code>Notification.Status</code>.
          </p>
        </section>
      </>
    )
  }
}
