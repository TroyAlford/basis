import { Button, CheckboxEditor, Component, Pin, TypedTable } from 'basis/react'

interface Task {
  complete: boolean,
  id: number,
  notes: string,
  owner: string,
  task: string,
}

interface State {
  tasks: Task[],
}

const INITIAL_TASKS: Task[] = [
  { complete: true, id: 1, notes: 'Ready', owner: 'Ada', task: 'Outline' },
  { complete: false, id: 2, notes: '', owner: 'Grace', task: 'Examples' },
  { complete: true, id: 3, notes: 'Review', owner: 'Linus', task: 'Links' },
  { complete: false, id: 4, notes: '', owner: 'Meg', task: 'Review' },
]

const { Column, Table } = TypedTable.of<Task>()

/**
 * Live example for declarative table header content.
 *
 * The owning component decides the header checkbox's checked, indeterminate and
 * disabled state; the Table only renders the slot. Header controls stay out of
 * the column's sort click, so toggling completion never reorders the table.
 */
export class TableHeaderExample extends Component<Record<string, never>, HTMLDivElement, State> {
  static displayName = 'TableHeaderExample'

  get defaultState(): State {
    return { tasks: INITIAL_TASKS.map(task => ({ ...task })) }
  }

  private get completeState(): boolean | null {
    const { tasks } = this.state
    if (!tasks.length) return false

    const complete = tasks.filter(task => task.complete).length
    if (complete === 0) return false
    if (complete === tasks.length) return true
    return null
  }

  private handleAllComplete = (value: boolean | null): void => {
    const complete = value === true
    void this.setState({
      tasks: this.state.tasks.map(task => ({ ...task, complete })),
    })
  }

  private handleClearNotes = (): void => {
    void this.setState({
      tasks: this.state.tasks.map(task => ({ ...task, notes: '' })),
    })
  }

  content() {
    const { tasks } = this.state
    const hasNotes = tasks.some(task => task.notes.length > 0)

    return (
      <div
        data-table-header-example
        style={{ border: '1px solid #ddd', borderRadius: '4px', maxWidth: '100%', overflow: 'hidden', width: '34em' }}
      >
        <Table readOnly value={tasks}>
          {Column.Boolean({
            field: 'complete',
            pin: Pin.Left,
            sortable: true,
            title: (
              <>
                <span>Done</span>
                <CheckboxEditor
                  label="Mark all tasks complete"
                  value={this.completeState}
                  onChange={this.handleAllComplete}
                />
              </>
            ),
            width: '8em',
          })}
          {Column.Text({ field: 'task', pin: Pin.Left, title: 'Task', width: '8em' })}
          {Column.Text({ field: 'owner', title: 'Owner', width: '8em' })}
          {Column.Text({
            field: 'notes',
            pin: Pin.Right,
            sortable: true,
            title: (
              <>
                <span>Notes</span>
                <Button disabled={!hasNotes} onActivate={this.handleClearNotes}>Clear</Button>
              </>
            ),
            width: '11em',
          })}
        </Table>
      </div>
    )
  }
}
