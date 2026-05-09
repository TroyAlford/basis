import * as React from 'react'
import { Button, Dialog, OverlayProvider, Toast } from '@basis/react'
import { Code } from '../components/Code'

export class OverlayProviderDocs extends React.Component {
  openDialog = async () => {
    await Dialog.confirm({
      confirmLabel: 'Continue',
      content: 'Dialogs render through the application overlay host.',
      title: 'Confirm action',
    })
  }

  createToast = () => {
    Toast.create({
      content: 'The toast can be updated or dismissed through its handle.',
      status: Toast.Status.Success,
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
            OverlayProvider is the host for context-safe dialogs and toasts. ApplicationBase renders
            it automatically inside the application context provider and after the normal layout.
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
          <h3>Toast</h3>
          <Button onActivate={this.createToast}>Create toast</Button>
          {Code.format(`
            import { Toast } from '@basis/react'

            const toast = Toast.create({
              title: 'Uploading',
              content: 'Preparing files...',
              status: Toast.Status.Loading,
              timeout: null,
            })

            toast.update({
              title: 'Uploaded',
              content: 'Files are ready.',
              status: Toast.Status.Success,
              timeout: 4000,
            })

            toast.dismiss()
          `)}
        </section>
        <OverlayProvider />
      </>
    )
  }
}
