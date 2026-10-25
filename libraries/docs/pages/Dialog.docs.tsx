import { Button, Dialog, Intent, Router } from 'basis/react'
import { Code } from '../components/Code'
import { DialogEditorExample } from '../components/DialogEditorExample'
import { DocumentationPage } from '../components/DocumentationPage'

interface State {
  lastChoice: string | null,
}

/**
 * Documentation for {@link Dialog}: managed handles, {@link Dialog.open},
 * {@link Dialog.choice}, {@link Dialog.confirm}, {@link Dialog.editor}, lifecycle callbacks,
 * persistent actions, stacking, and {@link Intent} chrome.
 */
export class DialogDocs extends DocumentationPage<State> {
  static override defaultProps = {
    ...DocumentationPage.defaultProps,
    initialValue: {
      lastChoice: null as string | null,
    },
  }

  openEditorDialog = async () => {
    void this.setState({ current: { ...this.current, lastChoice: 'opening…' } })

    const dialog = Dialog.editor(
      DialogEditorExample,
      {
        name: '',
        notes: '',
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

    window.setTimeout(() => {
      dialog.update({ title: 'Workspace article…' })
    }, 800)

    const result = await dialog

    void this.setState({
      current: {
        ...this.current,
        lastChoice: result === false ? 'cancelled' : `submitted: ${JSON.stringify(result)}`,
      },
    })
  }

  openConfirmPrimary = async () => {
    const confirmed = await Dialog.confirm({
      content: 'This dialog uses Intent.Primary on the shell and its affirmative action.',
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

  openStringConfirm = async () => {
    const confirmed = await Dialog.confirm('Would you like to continue?')
    void this.setState({
      current: { ...this.current, lastChoice: `string confirm: ${String(confirmed)}` },
    })
  }

  openChoice = async () => {
    const value = await Dialog.choice('Would you like some marmalade?', [
      ['yes', 'Yes, Please'],
      ['no', 'No, Thank You'],
    ] as const)

    void this.setState({ current: { ...this.current, lastChoice: `choice: ${String(value)}` } })
  }

  openCustomSuccess = async () => {
    const choice = await Dialog.open<'close' | 'cancel'>({
      buttons: [
        { label: 'Close', value: 'close' },
        { label: 'Cancel', value: 'cancel' },
      ],
      content: 'Success intent shows the SquareCheck icon and success-tinted header.',
      intent: Intent.Is.Success,
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
      intent: Intent.Is.Default,
      title: 'Choose mode',
    })
    void this.setState({ current: { ...this.current, lastChoice: String(value) } })
  }

  openLoadingUpdate = () => {
    const dialog = Dialog.open<string>(<p>Loading…</p>)

    window.setTimeout(() => {
      dialog.update({
        buttons: [{ label: 'Done', resolve: () => 'loaded' }],
        content: <p>Loaded!</p>,
      })
    }, 1_000)

    void dialog.then(value => {
      void this.setState({ current: { ...this.current, lastChoice: `loading → ${String(value)}` } })
    })
  }

  openPersistentSave = async () => {
    const dialog = Dialog.open({
      buttons: [
        {
          action: async () => {
            await new Promise<void>(resolve => window.setTimeout(resolve, 800))
            void this.setState({ current: { ...this.current, lastChoice: 'saved while staying open' } })
          },
          label: 'Save',
        },
        { label: 'Close', value: false },
      ],
      content: 'Save keeps this dialog mounted, blocks Escape while it is in flight, and leaves failure retryable.',
      title: 'Persistent editor',
    })

    const result = await dialog
    void this.setState({ current: { ...this.current, lastChoice: `persistent: ${String(result)}` } })
  }

  content() {
    const { lastChoice } = this.current

    return (
      <>
        <h1>Dialog</h1>
        <section>
          <p><code>Dialog</code> wraps the native <code>&lt;dialog&gt;</code> element. Static helpers <code>Dialog.open</code>, <code>Dialog.choice</code>, <code>Dialog.confirm</code>, and <code>Dialog.editor</code> register a row on the application <Router.Link to="/components/overlay-provider">OverlayProvider</Router.Link>, so they are safe to call from deep in the tree while the provider supplies the host.</p>
          <p>Dialogs and <Router.Link to="/components/notification">Notification</Router.Link> share one provider-owned lifecycle: a stable id, mutable options, exactly one terminal transition, callback dispatch, and cleanup. The renderers stay type-specific: dialogs use native modal stacking and focus; notifications use independent live regions.</p>
        </section>
        <section>
          <h2>Managed handles</h2>
          <p>Every helper returns the same awaitable handle shape. The handle is the actual Promise result extended with methods, so <code>await</code> and <code>.then()</code> compose with <code>id</code>, <code>update</code>, <code>dismiss</code>, and <code>resolve</code> on one object.</p>
          {Code.format(`
            interface DialogHandle<T> extends Promise<T | false> {
              readonly id: string
              update(options: Partial<DialogOptions<T>>): void
              dismiss(): Promise<boolean>
              resolve(value: T): Promise<boolean>
            }
          `)}
          <ul>
            <li><code>update</code> patches only supplied fields on the same mounted dialog, retaining omitted fields. Updates target the mounted row, which is gone once the dialog settles.</li>
            <li><code>resolve(value)</code> completes with a result. <code>dismiss()</code> abandons. Each returns <code>true</code> only when that request effected a terminal transition; veto, busy, non-topmost, and already-settled requests return <code>false</code>.</li>
            <li><code>id</code> stays stable across updates and is used for React reconciliation.</li>
          </ul>
        </section>
        <section>
          <h2>Interactive examples</h2>
          <p>
            <Button onActivate={this.openConfirmPrimary}>Dialog.confirm (primary)</Button>{' '}
            <Button onActivate={this.openConfirmDanger}>Dialog.confirm (danger)</Button>{' '}
            <Button onActivate={this.openStringConfirm}>Dialog.confirm (string)</Button>{' '}
            <Button onActivate={this.openChoice}>Dialog.choice</Button>{' '}
            <Button onActivate={this.openCustomSuccess}>Dialog.open (success)</Button>{' '}
            <Button onActivate={this.openTypedDialog}>Dialog.open (typed values)</Button>{' '}
            <Button onActivate={this.openLoadingUpdate}>JSX update</Button>{' '}
            <Button onActivate={this.openPersistentSave}>Persistent Save</Button>{' '}
            <Button onActivate={this.openEditorDialog}>Dialog.editor (dirty guard)</Button>
          </p>
          {lastChoice && (
            <p>Last result: <strong>{lastChoice}</strong></p>
          )}
        </section>
        <section>
          <h2><code>Dialog.open</code></h2>
          <p>Pass an options object for the historical behavior, or raw JSX/content for a handle-only overlay.</p>
          <ul>
            <li><strong>Options object</strong> — when <code>buttons</code> is omitted (or empty) it renders <strong>Cancel</strong> and <strong>OK</strong>. Cancel and Escape abandon; OK resolves <code>true</code>. Custom buttons can use <code>{'{'} label, value {'}'}</code>, <code>{'{'} label, resolve {'}'}</code>, JSX <code>data-value</code>, or a persistent <code>{'{'} label, action {'}'}</code>.</li>
            <li><strong>JSX/content shorthand</strong> — <code>Dialog.open(&lt;span&gt;Loading&lt;/span&gt;)</code> renders the content alone; close it through its handle or through native dismissal. This is the natural target for a loading-to-loaded update.</li>
          </ul>
          <p>An object button whose static <code>value</code> is <code>false</code> represents Cancel/dismissal. An explicitly programmed <code>resolve: () =&gt; false</code> is a real negative resolution, so lifecycle events distinguish it even though the public result is <code>false</code> in both cases.</p>
          {Code.format(`
            import { Dialog } from 'basis/react'

            const dialog = Dialog.open<string>(<span>Loading</span>)
            dialog.update({
              buttons: [{ label: 'Done', resolve: () => 'loaded' }],
              content: <span>Loaded!</span>,
            })
            const value = await dialog // 'loaded' | false

            const next = await Dialog.open<'edit' | 'view'>({
              buttons: [
                { label: 'View', value: 'view' },
                { label: 'Edit', value: 'edit' },
                { label: 'Cancel', value: false },
              ],
              content: 'Pick how to open this item.',
              title: 'Open as…',
            })
          `)}
        </section>
        <section>
          <h2><code>Dialog.choice</code> and <code>Dialog.confirm</code></h2>
          <p><code>Dialog.choice(question, choices)</code> renders one resolving button per ordered <code>[value, label]</code> tuple and infers the literal union of the values. Escape, native cancel, and backdrop abandonment still resolve <code>false</code>, while an explicitly offered <code>false</code> answer is a resolution.</p>
          <p><code>Dialog.confirm(question)</code> is the two-choice specialization: <strong>Yes</strong> resolves <code>true</code>, <strong>No</strong> resolves <code>false</code>, and Escape/dismissal abandons. The existing object signature keeps its own labels and Cancel semantics.</p>
          {Code.format(`
            import { Dialog } from 'basis/react'

            const selection = Dialog.choice('Would you like some marmalade?', [
              ['yes', 'Yes, Please'],
              ['no', 'No, Thank You'],
            ] as const)
            const value = await selection // 'yes' | 'no' | false

            const confirmed = await Dialog.confirm('Are you sure?') // boolean
            const chosen = await Dialog.confirm({
              content: 'This cannot be undone.',
              intent: Dialog.Intent.Danger,
              labelCancel: 'Keep',
              labelConfirm: 'Remove',
              title: 'Remove tag?',
            })
          `)}
        </section>
        <section>
          <h2><code>Dialog.editor</code></h2>
          <p>An editor dialog fixes its component class for the life of the handle. <code>T</code> comes from the supplied <code>Editor&lt;T&gt;</code> constructor — including indirect subclasses — using <code>InstanceType&lt;C&gt;['current']</code>. The second argument is a shallow <code>Partial&lt;T&gt;</code> checked against that constructor-established type, and the awaited result is the full <code>T | false</code>.</p>
          <p>The editor's explicit <code>static initialize(initialValue: Partial&lt;T&gt;): T</code> contract completes and validates the value before the handle is created. Editors with optional-only values validate and return the value; editors with required fields supply domain defaults or throw for incomplete input. The base <code>Editor.initialize</code> rejects the value. The resolved value is always the full <code>T</code>, and the baseline, dirty comparison, and resolved value stay coherent.</p>
          <p>The editor handle narrows <code>update</code> to shell options and partial typed <code>props</code> patches. A value-free update preserves the current draft, baseline, focus, and editor identity; an explicit <code>props.value</code> deliberately replaces the working value and flows through dirty checks and resolution.</p>
          <p>Dirty-state protection is built in. An unchanged editor dismisses immediately. A dirty editor asks with Basis-owned <strong>Keep editing</strong> and <strong>Discard</strong> actions through the same modal stack; vetoing keeps the draft and focus. A consumer <code>onDismissing</code> is an additional guard that runs only after that built-in decision. Affirmative completion runs <code>onResolving(latestValue)</code> and bypasses the abandonment guard.</p>
          {Code.format(`
            import { Dialog, Editor } from 'basis/react'

            class CardEditor extends Editor<Card> {
              static initialize(initialValue: Partial<Card>): Card {
                return {
                  name: initialValue.name ?? '',
                  cost: initialValue.cost ?? 0,
                }
              }
              // ...
            }

            // Partial input is valid; T is still Card.
            const dialog = Dialog.editor(CardEditor, { name: 'Card' }, {
              props: { label: 'Card' },
              title: 'Edit card',
            })

            dialog.update({ title: 'Workspace card' })
            dialog.update({ props: { readOnly: true } })
            dialog.update({ props: { value: updatedCard } })

            // Type errors:
            // dialog.update({ content: <div /> })
            // dialog.update({ editor: OtherEditor })
            // dialog.update({ props: { value: 'not a Card' } })
            // dialog.update({ props: { initialValue: updatedCard } })

            const edited = await dialog // Card | false
          `)}
          <p>An editor dialog returns values; persistence stays with the application. Use a non-resolving <code>Save</code> action where repeated persistence is required.</p>
        </section>
        <section>
          <h2>Lifecycle callbacks</h2>
          <p>Callbacks use one shared contract across both overlay kinds, distinguishing abandonment from resolution. Pre-terminal hooks can veto with <code>false</code>; async hooks are awaited before closing. A rejection or throw vetoes, keeps the overlay active, reports through <code>onError</code>, and rejects an imperative operation.</p>
          {Code.format(`
            const dialog = Dialog.open({
              content: 'Delete this item?',
              onDismissing: () => canLeave(),       // abandonment only; false vetoes
              onDismissed: () => console.log('closed'),
              onResolving: value => validate(value), // resolution only; false vetoes
              onResolved: value => console.log('resolved', value),
              onError: error => console.error(error),
              title: 'Delete',
            })
          `)}
          <ul>
            <li><code>onDismissing</code> / <code>onDismissed</code> cover Cancel/Close, Escape, native cancel, backdrop, and imperative <code>dismiss()</code>.</li>
            <li><code>onResolving(value)</code> / <code>onResolved(value)</code> cover affirmative footer choices and imperative <code>resolve(value)</code>.</li>
            <li>After-hooks run once before the public Promise settles; their errors are reported while the settled outcome stands.</li>
          </ul>
        </section>
        <section>
          <h2>Persistent actions</h2>
          <p>The non-resolving <code>{'{'} label, intent?, action {'}'}</code> form runs and keeps the same dialog mounted. Resolution stays with the dialog's resolving controls, and Enter targets those controls. An async action runs at most once concurrently; while it runs, repeated activation, Enter, Escape, Cancel, and programmatic terminal requests are blocked. Failure keeps the dialog open, reports through <code>onError</code>, and remains retryable.</p>
          {Code.format(`
            const dialog = Dialog.open({
              buttons: [
                {
                  action: async () => {
                    await saveDraft(draft)
                  },
                  label: 'Save',
                },
                { label: 'Close', value: false },
              ],
              content: draftEditor,
              title: 'Draft',
            })
          `)}
        </section>
        <section>
          <h2>Stacking and focus</h2>
          <p>Nested dialogs mount as a real stack of native dialogs. A parent guard can await a nested <code>Dialog.confirm</code> while its own transition is pending; the top dialog receives keyboard and backdrop interactions. Closing a child preserves the mounted parent and its unsaved state and restores focus to the prior element inside that parent. Closing the root restores the original trigger when it still exists. Updating a background dialog preserves the current focus.</p>
          {Code.format(`
            const dialog = Dialog.open({
              buttons: [{ label: 'Close', value: false }],
              content: unsavedEditor,
              onDismissing: async () => {
                const discard = await Dialog.confirm({
                  labelCancel: 'Keep editing',
                  labelConfirm: 'Discard',
                  title: 'Discard changes?',
                })
                return discard
              },
            })
          `)}
          <p>Provider teardown is a forced cleanup: it settles every stacked dialog as <code>false</code>, runs <code>onDismissed</code> at most once per row, releases guards immediately, and settles every public Promise.</p>
        </section>
        <section>
          <h2>Intent and header chrome</h2>
          <p>Optional <code>intent</code> on <code>DialogOptions</code> drives border and header styling on the dialog shell. <code>Dialog.Intent</code> is the same enum as <code>Notification.Intent</code> and the package export <code>Intent</code>. Shell <code>className</code> and <code>style</code> are documented options; Basis always owns header, body, and footer chrome.</p>
          <p>The header renders when a title, explicit icon, or intent glyph supplies content.</p>
          <ul>
            <li><strong>Default</strong>: neutral shell; the header appears with a <code>title</code> or intent chrome.</li>
            <li><strong>Primary</strong>: primary border; the header band uses text when a title is supplied.</li>
            <li><strong>Danger</strong>: danger border and header band; filled warning icon in the header.</li>
            <li><strong>Success</strong>: success border and header band; filled SquareCheck (checkbox) icon in the header.</li>
          </ul>
        </section>
        <section>
          <h2>Keyboard</h2>
          <ul>
            <li><strong>Escape</strong> — the top dialog receives native <code>keydown</code> (including focus on a footer button) or <code>cancel</code>, and routes one guarded dismissal.</li>
            <li><strong>Enter</strong> — an unhandled Enter activates the default action when the dialog has exactly one non-cancel, non-action button, or exactly one primary/affirmative choice. Multiline editors and editors that handle Enter keep their normal behavior. Enter targets the dialog's default resolving action; persistent actions participate through their own button.</li>
            <li><strong>Backdrop</strong> — a real outside click is distinguished from clicks inside the dialog content by hit-testing the native dialog bounds.</li>
          </ul>
        </section>
        <section>
          <h2>Related</h2>
          <ul>
            <li><Router.Link to="/components/notification">Notification</Router.Link> — nonmodal rows with the shared dismissal lifecycle.</li>
            <li><Router.Link to="/components/overlay-provider">OverlayProvider</Router.Link> — the single registration and stacking host.</li>
          </ul>
        </section>
      </>
    )
  }
}
