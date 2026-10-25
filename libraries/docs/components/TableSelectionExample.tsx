import type { RowSelectionState, TableKey } from 'basis/react'
import { Button, Component, Pin, TypedTable } from 'basis/react'
import type * as React from 'react'

interface Person {
  action: string,
  archived?: boolean,
  id: number,
  location: string,
  name: string,
  notes: string,
  role: string,
  status: string,
  team: string,
}

interface State {
  people: Person[],
  selected: Set<TableKey>,
}

const PEOPLE: Person[] = [
  {
    action: 'Open',
    id: 1,
    location: 'London',
    name: 'Ada Lovelace',
    notes: 'Analytical engine',
    role: 'Admin',
    status: 'Active',
    team: 'Platform',
  },
  {
    action: 'Open',
    id: 2,
    location: 'Arlington',
    name: 'Grace Hopper',
    notes: 'Compiler research',
    role: 'Editor',
    status: 'Active',
    team: 'Runtime',
  },
  {
    action: 'Open',
    id: 3,
    location: 'Helsinki',
    name: 'Linus Torvalds',
    notes: 'Kernel review',
    role: 'Editor',
    status: 'Active',
    team: 'Systems',
  },
  {
    action: 'Open',
    archived: true,
    id: 4,
    location: 'Toronto',
    name: 'Margaret Hamilton',
    notes: 'Flight software',
    role: 'Admin',
    status: 'Archived',
    team: 'Guidance',
  },
  {
    action: 'Open',
    id: 5,
    location: 'Portland',
    name: 'Barbara Liskov',
    notes: 'Substitution principle',
    role: 'Viewer',
    status: 'Active',
    team: 'Language',
  },
  {
    action: 'Open',
    id: 6,
    location: 'Cambridge',
    name: 'Radia Perlman',
    notes: 'Network spanning tree',
    role: 'Viewer',
    status: 'Active',
    team: 'Network',
  },
]

const { Column, Table } = TypedTable.of<Person>()

/**
 * A pinned Actions cell.
 * @param props - The cell props.
 * @param props.row - The row.
 * @returns The row action.
 */
const ActionCell = ({ row }: { row: Person }): React.ReactNode => (
  <Button disabled={row.archived} onActivate={() => undefined}>Open</Button>
)

/**
 * Live example for controlled table selection.
 *
 * The consumer owns the selected keys, the eligible page keys, and the reason a
 * row cannot be selected. The table only renders checkboxes and requests the
 * next set.
 */
export class TableSelectionExample extends Component<Record<string, never>, HTMLDivElement, State> {
  static displayName = 'TableSelectionExample'

  get defaultState(): State {
    return {
      people: PEOPLE.map(person => ({ ...person })),
      selected: new Set(),
    }
  }

  private get pageKeys(): TableKey[] {
    return this.state.people
      .filter(person => !person.archived)
      .map(person => person.id)
  }

  private handleSelectionChange = (selected: Set<TableKey>): void => {
    void this.setState({ selected })
  }

  private handleClear = (): void => {
    void this.setState({ selected: new Set() })
  }

  private getRowState = (person: Person): RowSelectionState => (
    person.archived
      ? { disabled: true, reason: 'Archived' }
      : { disabled: false }
  )

  private rowLabel = (person: Person): string => person.name

  content() {
    const { people, selected } = this.state

    return (
      <div data-table-selection-example style={{ maxWidth: '100%', width: 'fit-content' }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <strong>{selected.size} selected</strong>
          <Button disabled={!selected.size} onActivate={this.handleClear}>Clear selection</Button>
        </div>
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: '4px',
            maxWidth: '100%',
            overflow: 'hidden',
            width: '30em',
          }}
        >
          <Table
            readOnly
            value={people}
            selection={{
              getRowState: this.getRowState,
              onChange: this.handleSelectionChange,
              pageKeys: this.pageKeys,
              pageLabel: 'Select page',
              rowLabel: this.rowLabel,
              selectedKeys: selected,
            }}
          >
            {Column.Text({ field: 'name', pin: Pin.Left, title: 'Name' })}
            {Column.Text({ field: 'role', title: 'Role' })}
            {Column.Text({ field: 'team', title: 'Team' })}
            {Column.Text({ field: 'location', title: 'Location' })}
            {Column.Text({ field: 'status', title: 'Status' })}
            {Column.Text({ field: 'notes', title: 'Notes' })}
            {Column.Text({ component: ActionCell, field: 'action', pin: Pin.Right, title: 'Actions' })}
          </Table>
        </div>
      </div>
    )
  }
}
