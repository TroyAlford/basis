import { Component, Dialog, Editor, Notification, OverlayProvider, TextEditor } from 'basis/react'
import * as React from 'react'

declare global {
  interface Window {
    /** Browser-journey event log for the overlay fixture. */
    __overlayEvents?: string[],
    /** Create a notification while another overlay is open. */
    __overlayNotify?: () => void,
    /** Update the open editor dialog's shell without replacing the editor. */
    __overlayUpdateEditor?: () => void,
  }
}

interface Draft {
  name: string,
}

class DraftEditor extends Editor<Draft, HTMLDivElement, { label: string }> {
  static displayName = 'OverlayStageDraftEditor'

  static initialize(initialValue: Partial<Draft>): Draft {
    return { name: initialValue.name ?? '' }
  }

  get tag(): 'div' {
    return 'div'
  }

  content() {
    return (
      <TextEditor
        field="name"
        value={this.current.name}
        onChange={this.handleField}
      />
    )
  }
}

/**
 * Record one browser-journey event on the fixture's global log.
 * @param event - Event name.
 */
function record(event: string): void {
  if (!window.__overlayEvents) window.__overlayEvents = []
  window.__overlayEvents.push(event)
}

/**
 * Live overlay stage used by the real-browser acceptance journey. It mounts one
 * provider and exercises native dialog stacking, keyboard/cancel behavior,
 * backdrop hit-testing, editor dirty guards, focus restoration, scroll, and
 * notification coexistence.
 */
export class OverlayStage extends Component<object, HTMLDivElement> {
  static displayName = 'OverlayStage'

  get tag(): 'div' {
    return 'div'
  }

  openBasic = (): void => {
    record('open:basic')
    void Dialog.open({
      content: <p id="basic-content">Basic body</p>,
      onDismissed: () => record('basic:dismissed'),
      onDismissing: () => record('basic:dismissing'),
      title: 'Basic dialog',
    }).then(result => record(`basic:${String(result)}`))
  }

  openNested = (): void => {
    record('open:nested')
    void Dialog.open({
      buttons: [{ label: 'Close', value: false }],
      content: <button id="inner-focus" type="button">Inner focus</button>,
      onDismissed: () => record('parent:dismissed'),
      onDismissing: async () => {
        record('parent:dismissing')
        const discard = await Dialog.confirm({
          labelCancel: 'Keep editing',
          labelConfirm: 'Discard',
          title: 'Discard changes?',
        })
        record(`nested:${String(discard)}`)
        return discard
      },
      title: 'Parent dialog',
    }).then(result => record(`parent:${String(result)}`))
  }

  openEditor = (): void => {
    record('open:editor')
    const dialog = Dialog.editor(DraftEditor, { name: 'Start' }, {
      props: { label: 'Draft editor' },
      title: 'Edit draft',
    })

    window.__overlayUpdateEditor = () => dialog.update({ title: 'Workspace draft' })
    void dialog.then(result => record(`editor:${JSON.stringify(result)}`))
  }

  openSave = (): void => {
    record('open:save')
    void Dialog.open({
      buttons: [
        {
          action: async () => {
            record('save:start')
            await new Promise<void>(resolve => setTimeout(resolve, 150))
            record('save:end')
          },
          label: 'Save',
        },
        { label: 'Close', value: false },
      ],
      content: 'Persistent save',
      title: 'Save dialog',
    }).then(result => record(`save:${String(result)}`))
  }

  notify = (): void => {
    record('notify')
    Notification.create({
      content: 'Background note',
      onDismissed: () => record('notification:dismissed'),
      timeout: null,
      title: 'Note',
    })
  }

  componentDidMount(): void {
    super.componentDidMount()
    window.__overlayNotify = this.notify
  }

  content() {
    return (
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 24 }}>
          <button id="open-basic" type="button" onClick={this.openBasic}>Open basic</button>
          <button id="open-nested" type="button" onClick={this.openNested}>Open nested</button>
          <button id="open-editor" type="button" onClick={this.openEditor}>Open editor</button>
          <button id="open-save" type="button" onClick={this.openSave}>Open save</button>
          <button id="notify" type="button" onClick={this.notify}>Notify</button>
        </div>
        <div style={{ height: 2_000 }} />
        <OverlayProvider />
      </div>
    )
  }
}
