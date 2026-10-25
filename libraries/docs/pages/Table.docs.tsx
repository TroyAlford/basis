import { faker } from '@faker-js/faker'
import { Pin, Section, SortDirection, TextAlign, TypedTable } from 'basis/react'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'
import { TableHeaderExample } from '../components/TableHeaderExample'
import { TableSelectionExample } from '../components/TableSelectionExample'

faker.seed(42)

// Sample data types for demonstration
interface User {
  active: boolean,
  email: string,
  familyName: string,
  givenName: string,
  id: number,
  lastLogin: string,
  lastUpdated: string,
  name: string,
  profile: {
    avatar: string,
    bio: string,
  },
  role: string,
}

export class TableDocs extends DocumentationPage<Record<string, never>> {
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
        lastUpdated: faker.date.recent({ days: 7 }).toISOString(),
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

  content() {
    return (
      <>
        <h1>Table</h1>
        <Section title="Interactive Demo">
          <p>The Table component provides a flexible, type-safe way to display tabular data. Built on the Component base class, it offers excellent TypeScript ergonomics with strongly-typed columns and automatic field validation.</p>
          <div style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
            <UserTable data={this.users} />
          </div>
        </Section>
        <Section title="Basic Usage">
          <p>The simplest way to use the Table component is with the <code>TypedTable.of()</code> factory function, which provides type-safe column creation methods:</p>
          {Code.format(`
            import { TypedTable } from 'basis/react'

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
          <p>The Table component supports six built-in column types, each optimized for different data types:</p>
          <ul>
            <li><strong>Text</strong> - For string data, renders as TextEditor</li>
            <li><strong>Number</strong> - For numeric data, renders as NumberEditor</li>
            <li><strong>Boolean</strong> - For boolean data, renders as CheckboxEditor</li>
            <li><strong>Date</strong> - For date-only values, displays a formatted date</li>
            <li><strong>DateTime</strong> - For date-and-time values, displays a medium date and short time via <code>toLocaleString</code></li>
            <li><strong>Enum</strong> - For enumerated values, renders as EnumEditor with dropdown</li>
          </ul>
          <p>Each column type automatically configures appropriate sorting behavior and alignment:</p>
          <ul>
            <li>Text and Enum columns sort by name/label and are left-aligned</li>
            <li>Number, Boolean, Date, and DateTime columns sort by value</li>
            <li>Numbers are right-aligned; Booleans, Dates, and DateTimes are center-aligned</li>
          </ul>
        </Section>
        <Section title="Nested Data Access">
          <p>The Table component supports nested object properties using dot notation in the field path:</p>
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
          <p>Tables support pinning columns to the left or right side for better navigation of wide datasets:</p>
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
          <p>Pinned columns remain visible when scrolling horizontally, making them perfect for identifiers (like names or IDs) or important action columns.</p>
          <h4>Column Alignment</h4>
          <p>Control text alignment for each column type. Each column type has sensible defaults, but you can override them:</p>
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
            <li><strong>Boolean/Date/DateTime</strong>: Center-aligned</li>
          </ul>
          <h4>Row Interactions</h4>
          <p>Tables support click and double-click handlers for rows:</p>
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
          <p>You can disable sorting on specific columns or customize the sorting behavior:</p>
          {Code.format(`
            {Column.Text({ 
              field: 'name', 
              title: 'Name',
              sortable: false  // Disable sorting
            })}
          `)}
          <h4>Custom Key Fields</h4>
          <p>By default, tables use the 'id' field as the row key. You can specify a different field:</p>
          {Code.format(`
            <Table
              value={data}
              keyField="email"  // Use email as the unique identifier
            >
              {/* columns */}
            </Table>
          `)}
        </Section>
        <Section title="Custom Header Content">
          <p><code>title</code> accepts any React content, so a header can render an accessible checkbox or an action alongside its label. The header&#39;s native semantics come from that content, and its sort state is exposed with <code>aria-sort</code>.</p>
          <p>Interactive descendants of a title keep their own pointer and keyboard behavior and do not activate sorting; the rest of the header remains clickable and keyboard-sortable. In the example, click the <strong>Done</strong> or <strong>Notes</strong> label to sort; activating the checkbox or <strong>Clear</strong> button leaves the sort unchanged. The owning component controls a control&#39;s <code>checked</code>, <code>indeterminate</code> and <code>disabled</code> state. The example below renders an indeterminate checkbox until every task is complete, and disables the notes action when no row has notes. Both header controls live in pinned columns; narrow the viewport to see the pinned edges hold while the table scrolls.</p>
          <TableHeaderExample />
          {Code.format(`
            {Column.Boolean({
              field: 'complete',
              title: (
                <>
                  <span>Done</span>
                  <CheckboxEditor
                    label="Mark all tasks complete"
                    value={completeState}  // true, false, or null (indeterminate)
                    onChange={handleAllComplete}
                  />
                </>
              ),
            })}
          `)}
          <p>Any React content works, including native controls. A plain input keeps its own keyboard behavior and does not need to import a Basis component. This example&#39;s completion state and bulk update are ordinary consumer state, not a reusable table-selection API.</p>
        </Section>
        <Section title="Row Selection">
          <p>Selection is opt-in and fully controlled. Pass a <code>selection</code> object with the current <code>selectedKeys</code>, an <code>onChange</code> callback that receives a new set, and the consumer&#39;s eligible <code>pageKeys</code>. The table renders a pinned checkbox column and a header Select Page checkbox; it never owns a second selection store.</p>
          <p><code>getRowState</code> can disable an individual row and provide the reason, while <code>rowLabel</code> supplies the accessible row label. All keys come from the table&#39;s existing <code>keyField</code>, so sorting and filtering retain stable identity. Selection changes update the checkbox column and summary only; unrelated cell renderers are left untouched.</p>
          <TableSelectionExample />
          {Code.format(`
            <Table
              value={people}
              selection={{
                selectedKeys: selected,
                onChange: setSelected,
                pageKeys: people.map(person => person.id),
                getRowState: person => (
                  person.archived
                    ? { disabled: true, reason: 'Archived' }
                    : { disabled: false }
                ),
                rowLabel: person => person.name,
              }}
            >
              {Column.Text({ field: 'name', pin: Pin.Left, title: 'Name' })}
              {Column.Text({ field: 'role', title: 'Role' })}
              {Column.Text({ field: 'actions', pin: Pin.Right, title: 'Actions' })}
            </Table>
          `)}
        </Section>
        <Section title="API Reference">
          <h4>Table Props</h4>
          <ul>
            <li><code>className?: string</code> - Additional CSS classes</li>
            <li><code>keyField?: PathOf&lt;T&gt;</code> - Field to use as unique row identifier (default: 'id')</li>
            <li><code>readOnly?: boolean</code> - Whether the table is read-only</li>
            <li><code>selection?: TableSelection&lt;T&gt;</code> - Controlled row selection, including the pinned checkbox column and Select Page header</li>
            <li><code>value: T[]</code> - Array of data to display</li>
          </ul>
          <h4>Column Props</h4>
          <ul>
            <li><code>align?: TextAlign</code> - Text alignment (Left, Right, Center)</li>
            <li><code>enum?: Record&lt;string, string | number&gt;</code> - Enum options for Enum columns</li>
            <li><code>field: PathOf&lt;T&gt;</code> - Path to the data field (supports dot notation)</li>
            <li><code>pin?: Pin</code> - Column pinning position (Left, Right, Unpinned)</li>
            <li><code>sortable?: boolean</code> - Whether the column is sortable (default: true)</li>
            <li><code>title?: ReactNode</code> - Column header content, including interactive controls (defaults to field name)</li>
            <li><code>type?: ColumnType</code> - Column type (Text, Number, Boolean, Date, DateTime, Enum)</li>
            <li><code>width?: string | number</code> - Column width</li>
          </ul>
          <h4>Selection Props</h4>
          <ul>
            <li><code>selectedKeys: ReadonlySet&lt;TableKey&gt;</code> - The consumer-owned selected keys</li>
            <li><code>onChange: (selectedKeys: Set&lt;TableKey&gt;) =&gt; void</code> - Receives a new set when a row or the page checkbox is activated</li>
            <li><code>pageKeys?: readonly TableKey[]</code> - Eligible keys for Select Page; defaults to the selectable visible rows</li>
            <li><code>getRowState?: (row: T) =&gt; boolean | RowSelectionState</code> - Whether a row can be selected, optionally with a reason</li>
            <li><code>rowLabel?: (row: T) =&gt; string</code> - Accessible row label; defaults to the row key</li>
            <li><code>pageLabel?: string</code> - Accessible header label; defaults to "Select page"</li>
            <li><code>width?: string | number</code> - Selection column width; defaults to 2.5em</li>
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
      {Column.DateTime({ field: 'lastUpdated', title: 'Last Updated' })}
      {Column.Boolean({ field: 'active', title: 'Status' })}
      {Column.Text({ field: 'profile.bio', title: 'Bio' })}
    </Table>
  )
}
