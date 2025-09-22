import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { TextAlign } from '../../types/TextAlign'
import { Cell } from './Cell'
import type { ColumnProps } from './Column'
import { ColumnType } from './Column'

interface TestRow {
  active: boolean,
  age: number,
  id: number,
  name: string,
  role: string,
  user: {
    avatar: string,
    name: string,
  },
}

describe('Cell', () => {
  const defaultProps = {
    column: { field: 'name' as keyof TestRow } as ColumnProps<TestRow>,
    field: 'name' as keyof TestRow,
    row: {
      active: true,
      age: 30,
      id: 1,
      name: 'John Doe',
      role: 'admin',
      user: { avatar: 'avatar.jpg', name: 'John' },
    } as TestRow,
  }

  test('renders text editor for text type', async () => {
    const { node } = await render(<Cell {...defaultProps} type={ColumnType.Text} />)
    expect(node.tagName).toBe('TD')
    expect(node).toHaveClass('table-cell', 'component')
    expect(node).toHaveAttribute('data-field', 'name')
    expect(node).toHaveAttribute('data-type', 'text')
  })

  test('renders number editor for number type', async () => {
    const { node } = await render(
      <Cell
        {...defaultProps}
        column={{ field: 'age' } as ColumnProps<TestRow>}
        field="age"
        type={ColumnType.Number}
      />,
    )
    expect(node).toHaveAttribute('data-field', 'age')
    expect(node).toHaveAttribute('data-type', 'number')
  })

  test('renders checkbox editor for boolean type', async () => {
    const { node } = await render(
      <Cell
        {...defaultProps}
        column={{ field: 'active' } as ColumnProps<TestRow>}
        field="active"
        type={ColumnType.Boolean}
      />,
    )
    expect(node).toHaveAttribute('data-field', 'active')
    expect(node).toHaveAttribute('data-type', 'boolean')
  })

  test('renders enum editor for enum type', async () => {
    const { node } = await render(
      <Cell
        {...defaultProps}
        column={{ enum: { admin: 'Admin', user: 'User' }, field: 'role' } as ColumnProps<TestRow>}
        enum={{ admin: 'Admin', user: 'User' }}
        field="role"
        type={ColumnType.Enum}
      />,
    )
    expect(node).toHaveAttribute('data-field', 'role')
    expect(node).toHaveAttribute('data-type', 'enum')
  })

  test('renders date as formatted string for date type', async () => {
    const dateRow = { ...defaultProps.row, lastLogin: '2023-12-01T10:00:00Z' }
    const { node } = await render(
      <Cell
        {...defaultProps}
        column={{ field: 'lastLogin' }}
        field="lastLogin"
        row={dateRow}
        type={ColumnType.Date}
      />,
    )
    expect(node).toHaveAttribute('data-field', 'lastLogin')
    expect(node).toHaveAttribute('data-type', 'date')
    expect(node).toHaveTextContent('12/1/2023')
  })

  test('renders custom component when provided', async () => {
    const CustomComponent = ({ value }: { value: TestRow['user'] }) => (
      <div data-testid="custom-component">
        <span>{value.name}</span>
        <img alt={value.name} src={value.avatar} />
      </div>
    )

    const columnWithComponent = {
      component: CustomComponent,
      field: 'user' as keyof TestRow,
    } as ColumnProps<TestRow>

    const { node } = await render(<Cell {...defaultProps} column={columnWithComponent} field="user" />)

    expect(node).toHaveAttribute('data-field', 'user')
    expect(node.querySelector('[data-testid="custom-component"]')).toBeTruthy()
    expect(node).toHaveTextContent('John')
    expect(node.querySelector('img')).toHaveAttribute('src', 'avatar.jpg')
  })

  test('applies column width styling', async () => {
    const columnWithWidth = {
      field: 'name' as keyof TestRow,
      width: '200px',
    } as ColumnProps<TestRow>

    const { node } = await render(<Cell {...defaultProps} column={columnWithWidth} />)

    expect(node).toHaveStyle({
      minWidth: '200px',
      width: '200px',
    })
  })

  test('applies text alignment', async () => {
    const columnWithAlign = {
      align: TextAlign.Center,
      field: 'name' as keyof TestRow,
    } as ColumnProps<TestRow>

    const { node } = await render(
      <Cell {...defaultProps} align={TextAlign.Center} column={columnWithAlign} />,
    )

    expect(node).toHaveAttribute('data-align', 'center')
  })

  test('renders as th when header is true', async () => {
    const { node } = await render(<Cell {...defaultProps} header />)
    expect(node.tagName).toBe('TH')
  })

  test('renders as td when header is false', async () => {
    const { node } = await render(<Cell {...defaultProps} header={false} />)
    expect(node.tagName).toBe('TD')
  })

  test('uses provided value when available', async () => {
    const { node } = await render(<Cell {...defaultProps} value="Custom Value" />)
    expect(node).toHaveTextContent('Custom Value')
  })

  test('extracts value from row when no value provided', async () => {
    const { node } = await render(<Cell {...defaultProps} />)
    expect(node).toHaveTextContent('John Doe')
  })
})
