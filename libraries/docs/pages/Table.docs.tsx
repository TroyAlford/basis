import { faker } from '@faker-js/faker'
import * as React from 'react'
import { Pin, Section, SortDirection, TextAlign, TypedTable } from '@basis/react'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

faker.seed(42)

// Sample data types for demonstration
interface User {
  active: boolean,
  email: string,
  familyName: string,
  givenName: string,
  id: number,
  lastLogin: string,
  name: string,
  profile: {
    avatar: string,
    bio: string,
  },
  role: string,
}

export class TableDocs extends Documentation<Record<string, never>> {
  state = {
    current: {},
  }

  // Generate sample data with faker
  private generateUsers(count = 8): User[] {
    return Array.from({ length: count }, (_, i) => {
      const [givenName, familyName] = faker.person.fullName().split(' ')
      return {
        active: faker.datatype.boolean(),
        email: faker.internet.email({ firstName: givenName, lastName: familyName }),
        familyName,
        givenName,
        id: i + 1,
        lastLogin: faker.date.recent({ days: 30 }).toISOString(),
        name: `${givenName} ${familyName}`,
        profile: {
          avatar: faker.image.avatar(),
          bio: faker.person.bio(),
        },
        role: faker.helpers.enumValue(UserRole),
      }
    })
  }

  private users: User[] = this.generateUsers()

  content(): React.ReactNode {
    return (
      <>
        <h1>Table</h1>
        <Section title="Interactive Demo">
          <p>
            The Table component provides a flexible, type-safe way to display tabular data. Built on the Component
            base class, it offers excellent TypeScript ergonomics with strongly-typed columns and automatic
            field validation.
          </p>
          <div style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
            <UserTable data={this.users} />
          </div>
        </Section>
        <Section title="Basic Usage">
          <p>
            The simplest way to use the Table component is with the <code>TypedTable.of()</code> factory function,
            which provides type-safe column creation methods:
          </p>
          {Code.format(`
            import { TypedTable } from '@basis/react'

            interface User {
              id: number
              name: string
              email: string
              active: boolean
            }

            function UserTable({ data }: { data: User[] }) {
              const { Column, Table } = TypedTable.of<User>()

              return (
                <Table value={data}>
                  {Column.Number({ field: 'id', title: 'ID' })}
                  {Column.Text({ field: 'name', title: 'Name' })}
                  {Column.Text({ field: 'email', title: 'Email' })}
                  {Column.Boolean({ field: 'active', title: 'Status' })}
                </Table>
              )
            }
          `)}
        </Section>
        <Section title="Column Types">
          <p>
            The Table component supports five built-in column types, each optimized for different data types:
          </p>
          <ul>
            <li><strong>Text</strong> - For string data, renders as TextEditor</li>
            <li><strong>Number</strong> - For numeric data, renders as NumberEditor</li>
            <li><strong>Boolean</strong> - For boolean data, renders as ToggleEditor</li>
            <li><strong>Date</strong> - For date data, displays formatted dates</li>
            <li><strong>Enum</strong> - For enumerated values, renders as EnumEditor with dropdown</li>
          </ul>
          <p>
            Each column type automatically configures appropriate sorting behavior and alignment:
          </p>
          <ul>
            <li>Text and Enum columns sort by name/label and are left-aligned</li>
            <li>Number, Boolean, and Date columns sort by value</li>
            <li>Numbers are right-aligned, Booleans and Dates are center-aligned</li>
          </ul>
        </Section>
        <Section title="Nested Data Access">
          <p>
            The Table component supports nested object properties using dot notation in the field path:
          </p>
          {Code.format(`
            interface User {
              id: number
              name: string
              profile: {
                avatar: string
                bio: string
              }
            }

            // Access nested properties
            {Column.Text({ field: 'profile.bio', title: 'Bio' })}
            {Column.Text({ field: 'profile.avatar', title: 'Avatar URL' })}
          `)}
        </Section>
        <Section title="Advanced Features">
          <h4>Column Pinning</h4>
          <p>
            Tables support pinning columns to the left or right side for better navigation of wide datasets:
          </p>
          {Code.format(`
            {Column.Text({ 
              field: 'name', 
              title: 'Name',
              pin: Pin.Left  // Pin to left side
            })}
            {Column.Text({ 
              field: 'notes', 
              title: 'Notes',
              pin: Pin.Right  // Pin to right side
            })}
          `)}
          <p>
            Pinned columns remain visible when scrolling horizontally, making them perfect for
            identifiers (like names or IDs) or important action columns.
          </p>
          <h4>Column Alignment</h4>
          <p>
            Control text alignment for each column type. Each column type has sensible defaults,
            but you can override them:
          </p>
          {Code.format(`
            {Column.Number({ 
              field: 'price', 
              title: 'Price',
              align: TextAlign.Center  // Override default right alignment
            })}
            {Column.Text({ 
              field: 'description', 
              title: 'Description',
              align: TextAlign.Right  // Override default left alignment
            })}
          `)}
          <p>
            <strong>Default Alignments:</strong>
          </p>
          <ul>
            <li><strong>Text/Enum</strong>: Left-aligned</li>
            <li><strong>Number</strong>: Right-aligned</li>
            <li><strong>Boolean/Date</strong>: Center-aligned</li>
          </ul>
          <h4>Row Interactions</h4>
          <p>
            Tables support click and double-click handlers for rows:
          </p>
          {Code.format(`
            <Table
              value={data}
              onRowClick={(row, index) => console.log('Clicked row:', row)}
              onRowDoubleClick={(row, index) => console.log('Double-clicked row:', row)}
            >
              {/* columns */}
            </Table>
          `)}
          <h4>Custom Sorting</h4>
          <p>
            You can disable sorting on specific columns or customize the sorting behavior:
          </p>
          {Code.format(`
            {Column.Text({ 
              field: 'name', 
              title: 'Name',
              sortable: false  // Disable sorting
            })}
          `)}
          <h4>Custom Key Fields</h4>
          <p>
            By default, tables use the 'id' field as the row key. You can specify a different field:
          </p>
          {Code.format(`
            <Table
              value={data}
              keyField="email"  // Use email as the unique identifier
            >
              {/* columns */}
            </Table>
          `)}
        </Section>
        <Section title="API Reference">
          <h4>Table Props</h4>
          <ul>
            <li><code>className?: string</code> - Additional CSS classes</li>
            <li><code>keyField?: PathOf&lt;T&gt;</code> - Field to use as unique row identifier (default: 'id')</li>
            <li><code>readOnly?: boolean</code> - Whether the table is read-only</li>
            <li><code>value: T[]</code> - Array of data to display</li>
          </ul>
          <h4>Column Props</h4>
          <ul>
            <li><code>align?: TextAlign</code> - Text alignment (Left, Right, Center)</li>
            <li><code>enum?: Record&lt;string, string | number&gt;</code> - Enum options for Enum columns</li>
            <li><code>field: PathOf&lt;T&gt;</code> - Path to the data field (supports dot notation)</li>
            <li><code>pin?: Pin</code> - Column pinning position (Left, Right, Unpinned)</li>
            <li><code>sortable?: boolean</code> - Whether the column is sortable (default: true)</li>
            <li><code>title?: string</code> - Column header text (defaults to field name)</li>
            <li><code>type?: ColumnType</code> - Column type (Text, Number, Boolean, Date, Enum)</li>
            <li><code>width?: string | number</code> - Column width</li>
          </ul>
        </Section>
      </>
    )
  }
}

enum UserRole {
  Admin = 'admin',
  Editor = 'editor',
  Moderator = 'moderator',
  User = 'user',
}

// Demo components
/**
 * UserTable component - demonstrates nested data access
 * @param root0 - The data to display
 * @param root0.data - The data to display
 * @returns The UserTable component
 */
function UserTable({ data }: { data: User[] }) {
  const { Column, Table } = TypedTable.of<User>()

  return (
    <Table readOnly initialValue={data}>
      {Column.Number({ align: TextAlign.Center, field: 'id', header: true, pin: Pin.Left, title: 'ID' })}
      {Column.Text({ field: 'name', pin: Pin.Left, sortDirection: SortDirection.Asc, title: 'Name' })}
      {Column.Text({ field: 'email', title: 'Email' })}
      {Column.Enum({ enum: UserRole, field: 'role', title: 'Role' })}
      {Column.Date({ field: 'lastLogin', title: 'Last Login' })}
      {Column.Boolean({ field: 'active', title: 'Status' })}
      {Column.Text({ field: 'profile.bio', title: 'Bio' })}
    </Table>
  )
}
