import type { CellProps } from 'basis/react'
import { Button, CellContent, Column as StaticColumn, ColumnType, TypedTable } from 'basis/react'
import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'

interface Person {
  id: number,
  name: string,
  status: boolean,
}

interface Project {
  id: number,
  title: string,
}

const PEOPLE: Person[] = [
  { id: 1, name: 'Ada', status: true },
  { id: 2, name: 'Grace', status: false },
]

const { Column, Table } = TypedTable.of<Person>()

class NameCell extends CellContent<Person> {
  static displayName = 'NameCell'

  content() {
    return <span data-testid="name-cell">{this.props.row.name}</span>
  }
}

class ProjectCell extends CellContent<Project> {
  static displayName = 'ProjectCell'

  content() {
    return <span>{this.props.row.title}</span>
  }
}

class NameValueCell extends CellContent<Person, 'name'> {
  static displayName = 'NameValueCell'

  content() {
    return <span>{this.props.value.toUpperCase()}</span>
  }
}

class IdValueCell extends CellContent<Person, 'id'> {
  static displayName = 'IdValueCell'

  content() {
    return <span>{this.props.value.toFixed()}</span>
  }
}

class ActionsPlaceholder extends CellContent<Person> {
  static displayName = 'ActionsPlaceholder'

  content() {
    return null
  }
}

const NameTextCell = ({ value }: CellProps<string, Person, 'name'>): React.ReactNode => (
  <span>{value.toUpperCase()}</span>
)

const ProjectTextCell = ({ value }: CellProps<string, Project, 'title'>): React.ReactNode => (
  <span>{value.toUpperCase()}</span>
)

describe('Table custom cells', () => {
  test('exports the Custom column type', () => {
    expect(String(ColumnType.Custom)).toBe('custom')
  })

  test('renders a Basis class cell declared through the public contract', async () => {
    const { node } = await render(
      <Table value={PEOPLE}>
        {Column.Text({ component: NameCell, field: 'name', title: 'Name' })}
      </Table>,
    )

    expect(node).toHaveTextContent('Ada')
    expect(node).toHaveTextContent('Grace')
  })

  test('renders a custom column with a class cell and an action button', async () => {
    const onActivate = mock()

    class ActionsCell extends CellContent<Person> {
      static displayName = 'ActionsCell'

      content() {
        return (
          <Button onActivate={() => onActivate(this.props.row.id)}>Edit {this.props.row.name}</Button>
        )
      }
    }

    const { node } = await render(
      <Table value={PEOPLE}>
        {Column.Custom({
          component: ActionsCell,
          field: 'name',
          sortable: false,
          title: 'Actions',
        })}
      </Table>,
    )

    const cell = node.querySelector('td[data-field="name"]') as HTMLTableCellElement
    const button = cell.querySelector('button') as HTMLButtonElement

    expect(cell).toHaveAttribute('data-type', 'custom')
    expect(button).toHaveTextContent('Edit Ada')

    button.click()
    expect(onActivate).toHaveBeenCalledWith(1)
  })

  test('types class cells against the table row', () => {
    const compileOnly = false as boolean

    if (compileOnly) {
      // A class cell for the table's row is accepted without a cast.
      Column.Text({ component: NameCell, field: 'name', title: 'Name' })

      // Custom requires a component and accepts the class contract.
      Column.Custom({ component: ActionsPlaceholder, field: 'name', title: 'Actions' })

      // @ts-expect-error a cell for a different row is rejected
      Column.Text({ component: ProjectCell, field: 'name', title: 'Name' })

      // @ts-expect-error a custom column requires a component
      Column.Custom({ field: 'name', title: 'Actions' })
    }
  })

  test('infers the field type for column components', () => {
    const compileOnly = false as boolean

    if (compileOnly) {
      Column.Custom({ component: NameValueCell, field: 'name', title: 'Name' })
      Column.Text({ component: NameTextCell, field: 'name', title: 'Name' })

      // @ts-expect-error the cell's number value cannot render the name string
      Column.Custom({ component: IdValueCell, field: 'name', title: 'Name' })

      // The static factories enforce the same field contract.
      StaticColumn.Text({ component: NameValueCell, field: 'name', title: 'Name' })

      // @ts-expect-error the cell's number value cannot render the name string
      StaticColumn.Text({ component: IdValueCell, field: 'name', title: 'Name' })

      // @ts-expect-error a component for a different row is rejected
      Column.Text({ component: ProjectTextCell, field: 'name', title: 'Name' })
    }
  })
})
