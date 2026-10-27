import { CellContent, Column, TypedTable } from 'basis/react'
import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'

interface Person {
  id: number,
  name: string,
  status: boolean,
}

interface Employee extends Person {
  team: string,
}

interface Project {
  id: number,
  title: string,
}

interface Tag {
  label: string,
}

const PEOPLE: Person[] = [
  { id: 1, name: 'Ada', status: true },
  { id: 2, name: 'Grace', status: false },
]

class PersonNameCell extends CellContent<Person> {
  static displayName = 'PersonNameCell'

  content() {
    return <strong>{this.props.row.name}</strong>
  }
}

class IdCell<TRow extends { id: number }> extends CellContent<TRow> {
  static displayName = 'IdCell'

  content() {
    return <span data-testid="id-cell">{this.props.row.id}</span>
  }
}

const AppTable = TypedTable.extend({
  Name: Column.custom(PersonNameCell, { sortable: false }),
})

const GenericTable = TypedTable.extend({
  Id: Column.custom(IdCell),
})

describe('TypedTable.extend', () => {
  test('exposes a registered column factory alongside the built-in columns', async () => {
    const { Column: AppColumn, Table } = AppTable.of<Person>()

    const { node } = await render(
      <Table value={PEOPLE}>
        {AppColumn.Name({ field: 'name', title: 'Person' })}
        {AppColumn.Boolean({ field: 'status', title: 'Status' })}
      </Table>,
    )

    const nameHeader = node.querySelector('th[data-field="name"]') as HTMLTableCellElement
    expect(nameHeader).toHaveAttribute('data-sortable', 'false')
    expect(node.querySelector('th[data-field="status"]')).not.toBeNull()
    expect(node).toHaveTextContent('Ada')
    expect(node).toHaveTextContent('Grace')
  })

  test('lets a per-use declaration override registered defaults', async () => {
    const { Column: AppColumn, Table } = AppTable.of<Person>()

    const { node } = await render(
      <Table value={PEOPLE}>
        {AppColumn.Name({ field: 'name', sortable: true, title: 'Person' })}
      </Table>,
    )

    const nameHeader = node.querySelector('th[data-field="name"]') as HTMLTableCellElement
    expect(nameHeader).toHaveAttribute('data-sortable', 'true')
  })

  test('passes the selected row into a generic registered factory', async () => {
    const { Column: AppColumn, Table } = GenericTable.of<Person>()

    const { node } = await render(
      <Table value={PEOPLE}>
        {AppColumn.Id({ field: 'id', title: 'ID' })}
      </Table>,
    )

    const cells = node.querySelectorAll('[data-testid="id-cell"]')
    expect(cells).toHaveLength(2)
    expect(cells[0]).toHaveTextContent('1')
    expect(cells[1]).toHaveTextContent('2')
  })

  test('rebases a generic factory onto compatible rows', () => {
    const compileOnly = false as boolean

    if (compileOnly) {
      GenericTable.of<Person>().Column.Id({ field: 'id', title: 'ID' })
      GenericTable.of<Project>().Column.Id({ field: 'id', title: 'ID' })

      // @ts-expect-error the row does not satisfy the cell's id requirement
      GenericTable.of<Tag>().Column.Id({ field: 'label', title: 'ID' })
    }
  })

  test('passes the table row into registered factories', () => {
    const compileOnly = false as boolean

    if (compileOnly) {
      // The registered factory is rebased onto the row selected by `.of`.
      AppTable.of<Person>().Column.Name({ field: 'name', title: 'Person' })
      AppTable.of<Employee>().Column.Name({ field: 'name', title: 'Employee' })

      // @ts-expect-error a Person column is not available for an unrelated row
      AppTable.of<Project>().Column.Name({ field: 'title', title: 'Project' })

      // @ts-expect-error the row still constrains the field path
      AppTable.of<Person>().Column.Name({ field: 'missing', title: 'Missing' })
    }
  })

  test('accepts an explicit row type when registering the factory', () => {
    const compileOnly = false as boolean

    if (compileOnly) {
      const ExplicitTable = TypedTable.extend({
        Name: Column.custom<Person>(PersonNameCell),
      })

      ExplicitTable.of<Person>().Column.Name({ field: 'name', title: 'Person' })
      ExplicitTable.of<Employee>().Column.Name({ field: 'name', title: 'Employee' })

      // @ts-expect-error the factory is bound to Person
      ExplicitTable.of<Project>().Column.Name({ field: 'title', title: 'Project' })
    }
  })
})
