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

  openDangerDialog = async () => {
    await Dialog.confirm({
      content: 'This uses Intent.Danger on the dialog chrome and confirm button.',
      danger: true,
      labelConfirm: 'Delete',
      title: 'Delete item?',
    })
  }

  createPrimaryNotification = () => {
    Notification.create({
      content: 'Primary intent tints the header with the brand color; there is no icon.',
      intent: Notification.Intent.Primary,
      timeout: 4_000,
      title: 'Saved',
    })
  }

  createDangerNotification = () => {
    Notification.create({
      content: 'Danger intent adds the warning icon and danger-tinted header.',
      intent: Notification.Intent.Danger,
      timeout: 4_000,
      title: 'Could not save',
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
          <h3>Intent (dialog chrome and notifications)</h3>
          <p>
            Both <code>Dialog</code> and <code>Notification</code> use the same{' '}
            <code>Intent</code> enum (<code>Default</code>, <code>Primary</code>, <code>Danger</code>).
            When the header is shown, <code>Intent.Danger</code> uses the theme{' '}
            <code>--basis-color-danger</code> background with <code>--basis-color-danger-contrast</code>{' '}
            text and a warning icon. <code>Intent.Primary</code> uses <code>--basis-color-primary</code> with{' '}
            <code>--basis-color-contrast</code> text and no icon. <code>Intent.Default</code> keeps a neutral
            header. Set <code>intent</code> on <code>Dialog.open</code> / <code>INotification</code>;{' '}
            <code>Dialog.confirm</code> sets <code>intent</code> from its <code>danger</code> flag (primary vs
            danger).
          </p>
        </section>
        <section>
          <h3>Dialog</h3>
          <p>
            <Button onActivate={this.openDialog}>Confirm (primary chrome)</Button>{' '}
            <Button onActivate={this.openDangerDialog}>Confirm danger</Button>
          </p>
          {Code.format(`
            import { Dialog, Intent } from '@basis/react'

            const result = await Dialog.open({
              title: 'Delete item',
              content: 'This cannot be undone.',
              cancelValue: false,
              intent: Intent.Danger,
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
          <p>
            <Button onActivate={this.createPrimaryNotification}>Primary notification</Button>{' '}
            <Button onActivate={this.createDangerNotification}>Danger notification</Button>
          </p>
          {Code.format(`
            import { Notification } from '@basis/react'

            const note = Notification.create({
              title: 'Uploading',
              content: 'Preparing files...',
              intent: Notification.Intent.Primary,
              timeout: null,
            })

            note.update({
              title: 'Uploaded',
              content: 'Files are ready.',
              intent: Notification.Intent.Primary,
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
            Shared overlay chrome and button styling use <code>Intent</code> (also exported as{' '}
            <code>DialogIntent</code>; <code>Dialog.Intent</code> and <code>Notification.Intent</code> are the
            same enum).
          </p>
        </section>
      </>
    )
  }
}
