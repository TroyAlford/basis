import { Button, Dialog, Intent, Router } from '@basis/react'
import { Code } from '../components/Code'
import { DialogEditorExample } from '../components/DialogEditorExample'
import { Documentation } from '../components/Documentation'

interface State {
  lastChoice: string | null,
}

/**
 * Documentation for {@link Dialog}: native modal API, {@link Dialog.open}, {@link Dialog.confirm},{' '}
 * {@link Dialog.editor}, and {@link Intent} chrome.
 */
export class DialogDocs extends Documentation<State> {
  static override defaultProps = {
    ...Documentation.defaultProps,
    initialValue: {
      lastChoice: null as string | null,
    },
  }

  openEditorDialog = async () => {
    void this.setState({ current: { ...this.current, lastChoice: 'opening…' } })

    const result = await Dialog.editor(
      DialogEditorExample,
      {
        name: '',
        slug: '',
      },
      {
        props: {
          onChange: value => {
            void this.setState({
              current: { ...this.current, lastChoice: `draft: ${JSON.stringify(value)}` },
            })
          },
        },
        title: 'New article…',
      },
    )

    void this.setState({
      current: {
        ...this.current,
        lastChoice: result === false ? 'cancelled' : `submitted: ${JSON.stringify(result)}`,
      },
    })
  }

  openConfirmPrimary = async () => {
    const confirmed = await Dialog.confirm({
      content: 'This dialog uses Intent.Primary on the shell (no header icon).',
      title: 'Continue?',
    })
    void this.setState({
      current: { ...this.current, lastChoice: confirmed ? 'confirmed (primary)' : 'cancelled' },
    })
  }

  openConfirmDanger = async () => {
    const confirmed = await Dialog.confirm({
      content: 'Danger intent shows the warning icon and danger-tinted header.',
      intent: Dialog.Intent.Danger,
      labelConfirm: 'Delete',
      title: 'Delete item?',
    })
    void this.setState({
      current: { ...this.current, lastChoice: confirmed ? 'confirmed (delete)' : 'cancelled' },
    })
  }

  openCustomSuccess = async () => {
    const choice = await Dialog.open<'close' | 'cancel'>({
      buttons: [
        { label: 'Close', value: 'close' },
        { label: 'Cancel', value: 'cancel' },
      ],
      content: 'Success intent shows the SquareCheck icon and success-tinted header.',
      intent: Intent.Success,
      title: 'Saved',
    })
    void this.setState({ current: { ...this.current, lastChoice: String(choice) } })
  }

  openTypedDialog = async () => {
    const value = await Dialog.open<'read' | 'write' | 'cancel'>({
      buttons: [
        { label: 'Read', value: 'read' },
        { label: 'Write', value: 'write' },
        <Button key="cancel" data-value="cancel">Cancel</Button>,
      ],
      content: 'Each button carries an arbitrary value; the promise resolves with the chosen value.',
      intent: Intent.Default,
      title: 'Choose mode',
    })
    void this.setState({ current: { ...this.current, lastChoice: String(value) } })
  }

  content() {
    const { lastChoice } = this.current

    return (
      <>
        <h1>Dialog</h1>
        <section>
          <p>
            <code>Dialog</code> wraps the native <code>&lt;dialog&gt;</code> element. Static helpers{' '}
            <code>Dialog.open</code>, <code>Dialog.confirm</code>, and <code>Dialog.editor</code>{' '}
            enqueue a row on the application{' '}
            <Router.Link to="/components/overlay-provider">OverlayProvider</Router.Link>, so they are safe
            to call from deep in the tree without threading props.
          </p>
          <p>
            Import <code>type {'{'} IDialog {'}'}</code> from the same module as <code>Dialog</code> when you
            need the request payload shape; it is not re-exported from <code>@basis/react</code>.
          </p>
        </section>
        <section>
          <h2>Intent and header chrome</h2>
          <p>
            Optional <code>intent</code> on <code>IDialog</code> drives border and header styling on the dialog
            shell. <code>Dialog.Intent</code> is the same enum as <code>Notification.Intent</code> and the
            package export <code>Intent</code>.
          </p>
          <ul>
            <li>
              <strong>Default</strong>: neutral shell; header shows when you pass a <code>title</code> (or
              when another intent would show chrome without a title).
            </li>
            <li>
              <strong>Primary</strong>: primary border and header band using <code>--basis-color-primary</code>{' '}
              and <code>--basis-color-contrast</code>; no icon.
            </li>
            <li>
              <strong>Danger</strong>: danger border and header band with <code>--basis-color-danger</code> /{' '}
              <code>--basis-color-danger-contrast</code>; warning icon in the header.
            </li>
            <li>
              <strong>Success</strong>: success border and header band with <code>--basis-color-success</code> /{' '}
              <code>--basis-color-success-contrast</code>; SquareCheck (checkbox) icon in the header.
            </li>
          </ul>
          <p>
            Theme tokens for danger and success are documented on the{' '}
            <Router.Link to="/components/theme">Theme</Router.Link> page. <code>Dialog.confirm</code> accepts{' '}
            <code>intent</code> (default <code>Primary</code>); the confirm button uses the same intent for{' '}
            <code>Danger</code> and <code>Success</code>, and <code>Primary</code> for other shell intents.
          </p>
        </section>
        <section>
          <h2>Interactive examples</h2>
          <p>
            <Button onActivate={this.openConfirmPrimary}>Dialog.confirm (primary)</Button>{' '}
            <Button onActivate={this.openConfirmDanger}>Dialog.confirm (danger)</Button>{' '}
            <Button onActivate={this.openCustomSuccess}>Dialog.open (success)</Button>{' '}
            <Button onActivate={this.openTypedDialog}>Dialog.open (typed values)</Button>{' '}
            <Button onActivate={this.openEditorDialog}>Dialog.editor (editor dialog)</Button>
          </p>
          {lastChoice && (
            <p>
              Last result: <strong>{lastChoice}</strong>
            </p>
          )}
        </section>
        <section>
          <h2><code>Dialog.open</code></h2>
          <p>
            With custom buttons, returns <code>Promise&lt;T | false&gt;</code> that resolves with the clicked
            button&apos;s <code>value</code>, a definition <code>resolve</code> callback evaluated at
            activation time, or a JSX button <code>data-value</code>. Escape, native cancel, and other
            dismiss paths resolve <code>false</code>. With no custom buttons,{' '}
            <code>Dialog.open()</code> returns <code>Promise&lt;boolean&gt;</code>.
          </p>
          <p>
            With no request, or with only <code>title</code> / <code>content</code>, <code>Dialog.open()</code>{' '}
            renders <strong>Cancel</strong> and <strong>OK</strong>. Cancel and Escape resolve{' '}
            <code>false</code>; OK resolves <code>true</code>. Custom button dialogs can use{' '}
            <code>{'{'} label, value {'}'}</code>, <code>&lt;Button data-value="..."&gt;</code>, or a mix of
            both. Button intent defaults to <code>Intent.Default</code>, while the dialog shell intent defaults
            to <code>Intent.Primary</code>.
          </p>
          {Code.format(`
            import { Button, Dialog, Intent } from '@basis/react'

            const defaultResult = await Dialog.open({
              content: 'Cancel resolves false; OK resolves true.',
              title: 'Continue?',
            })

            const next = await Dialog.open<'edit' | 'view'>({
              buttons: [
                { label: 'View', value: 'view' },
                { label: 'Edit', value: 'edit' },
                <Button key="cancel" data-value="cancel">Cancel</Button>,
              ],
              content: 'Pick how to open this item.',
              intent: Intent.Success,
              title: 'Open as…',
            })
          `)}
        </section>
        <section>
          <h2><code>Dialog.editor</code></h2>
          <p>
            For route or form flows built with an <code>Editor</code> subclass, <code>Dialog.editor</code>{' '}
            mounts that editor as the dialog body and resolves <code>Promise&lt;Value | false&gt;</code>. It
            records a variable initialized from the <code>initialValue</code> argument, assigns on each editor{' '}
            <code>onChange</code>, and returns that variable when the user confirms; cancel, Escape, and dismiss
            resolve <code>false</code>. <code>Value</code> is inferred from <code>initialValue</code>.
          </p>
          <p>
            The editor dialog currently uses the standard <strong>OK</strong> and <strong>Cancel</strong> buttons
            (JSX <code>&lt;Button data-value=...&gt;</code> under the hood). For fully custom button labels and
            values, use <code>Dialog.open</code> directly.
          </p>
          {Code.format(`
            import { Dialog, Editor } from '@basis/react'

            interface NameAndSlug {
              name: string
              slug: string
            }

            class CreateEditor extends Editor<NameAndSlug, HTMLDivElement> {
              // ...
            }

            const result = await Dialog.editor(
              CreateEditor,
              { name: '', slug: '' },
              {
                content: 'Name and slug are required.',
                props: {
                  onChange: value => console.log('draft', value),
                },
                title: 'New Article…',
              },
            )
            if (result === false) return
            // result is NameAndSlug
            result.slug
          `)}
          {Code.format(`
            // Using the resolved value (same type as initialValue)
            const created = await Dialog.editor(
              CreateEditor,
              { name: '', slug: '' },
              { title: 'New Article…' },
            )
            if (created === false) return
            console.log('submitted', created)
            created.slug
          `)}
        </section>
        <section>
          <h2><code>Dialog.confirm</code></h2>
          <p>
            Convenience wrapper around <code>Dialog.open&lt;boolean&gt;</code> with cancel and confirm
            buttons. OK resolves <code>true</code>; Cancel and Escape resolve <code>false</code>. Pass{' '}
            <code>intent: Dialog.Intent.Danger</code> for destructive confirmations (danger chrome and
            confirm button intent).
          </p>
          {Code.format(`
            import { Dialog } from '@basis/react'

            const ok = await Dialog.confirm({
              content: 'This cannot be undone.',
              intent: Dialog.Intent.Danger,
              labelCancel: 'Keep',
              labelConfirm: 'Remove',
              title: 'Remove tag?',
            })
          `)}
        </section>
        <section>
          <h2>Keyboard</h2>
          <p>
            The dialog shell listens for <code>keydown</code> on the native <code>&lt;dialog&gt;</code>.
            Escape is handled in the <strong>capture</strong> phase so it still dismisses when focus is
            inside a nested <code>TextEditor</code>; Enter uses the bubble phase so nested controls can
            call <code>preventDefault()</code> first (for example <code>TagsEditor</code> on Enter).
            The native <code>cancel</code> event is wired as well.
          </p>
          <ul>
            <li>
              <strong>Escape</strong> — dismisses and resolves <code>false</code> (same as Cancel), including
              when focus is inside a single-line <code>TextEditor</code>.
            </li>
            <li>
              <strong>Enter</strong> — activates the default footer action when the dialog has an unambiguous
              primary button and focus is in a single-line control. Enter in a multiline{' '}
              <code>TextEditor</code> inserts a newline and does not confirm. Dialogs with multiple
              non-cancel actions do not bind Enter.
            </li>
          </ul>
        </section>
        <section>
          <h2>Related</h2>
          <ul>
            <li>
              <Router.Link to="/components/notification">Notification</Router.Link> — toast-style messages
              using the same <code>Intent</code> enum.
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
