import { faker } from '@faker-js/faker'
import { CellContent, Component, Pin, Section, SortDirection, TextAlign, TypedTable } from 'basis/react'
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
        <Section title="TypedTable">
          <p><code>TypedTable</code> is the type-safe entry point for tables. <code>TypedTable.of&lt;Row&gt;()</code> fixes the row type and returns a <code>Table</code> component plus the built-in column factories, so a field path drives the value type that a column component must accept.</p>
          <p><code>TypedTable.extend(registry)</code> adds application-defined column factories to that same facade. Register the application's vocabulary once, then select the row with <code>.of&lt;Row&gt;()</code> wherever a table is declared.</p>
        </Section>
        <Section title="Interactive Demo">
          <p>The Table component provides a flexible, type-safe way to display tabular data. Built on the Component base class, it offers excellent TypeScript ergonomics with strongly-typed columns and automatic field validation.</p>
          <div style={{ border: '1px solid var(--basis-color-border-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
            <UserTable data={this.users} />
          </div>
        </Section>
        <Section title="Basic Usage">
          <p>The simplest way to use the Table component is with the <code>TypedTable.of()</code> factory function, which provides type-safe column creation methods:</p>
          {Code.format(`
            import { Component, TypedTable } from 'basis/react'

            interface User {
              id: number
              name: string
              email: string
              active: boolean
            }

            interface UserTableProps {
              data: User[]
            }

            class UserTable extends Component<UserTableProps> {
              static displayName = 'UserTable'

              override render(): React.ReactNode {
                const { Column, Table } = TypedTable.of<User>()

                return (
                  <Table readOnly initialValue={this.props.data}>
                    {Column.Number({ field: 'id', title: 'ID' })}
                    {Column.Text({ field: 'name', title: 'Name' })}
                    {Column.Text({ field: 'email', title: 'Email' })}
                    {Column.Boolean({ field: 'active', title: 'Status' })}
                  </Table>
                )
              }
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
        <Section title="Custom Cells">
          <p>Use <code>Column.Custom</code> when a column needs its own rendering. The cell is a normal Basis class extending <code>CellContent&lt;Row&gt;</code>, so it follows the same class architecture as the rest of the UI and receives typed <code>row</code>, <code>value</code>, <code>field</code>, and <code>column</code> props. The interactive demo above uses a class cell for the name column.</p>
          <p><code>Column.Custom</code> (capital C) declares one column in place. <code>Column.custom</code> (lowercase) creates a reusable factory for <code>TypedTable.extend</code>; see <strong>Reusable Column Types</strong> below. The table's internal <code>Cell</code> renderer is not an extension point — extend <code>CellContent</code> for cell content.</p>
          {Code.format(`
            import { CellContent, TypedTable } from 'basis/react'

            interface User {
              id: number
              name: string
              email: string
            }

            class NameCell extends CellContent<User> {
              static displayName = 'NameCell'

              content() {
                const { email, name } = this.props.row
                return (
                  <span>
                    <strong>{name}</strong>
                    <small>{email}</small>
                  </span>
                )
              }
            }

            const { Column } = TypedTable.of<User>()

            Column.Custom({ component: NameCell, field: 'name', title: 'Name' })
          `)}
          <p>Specify the field as the second generic when the cell needs a precisely typed <code>value</code>:</p>
          {Code.format(`
            class StatusCell extends CellContent<User, 'active'> {
              static displayName = 'StatusCell'

              content() {
                return this.props.value ? 'Active' : 'Inactive'
              }
            }
          `)}
          <p>An action cell uses the same contract. It renders the control and leaves the action to its owner:</p>
          {Code.format(`
            import { Button, CellContent } from 'basis/react'

            class ActionsCell extends CellContent<User> {
              static displayName = 'ActionsCell'

              content() {
                return (
                  <Button onActivate={() => editUser(this.props.row)}>
                    Edit
                  </Button>
                )
              }
            }

            {Column.Custom({
              component: ActionsCell,
              field: 'id',
              sortable: false,
              title: 'Actions'
            })}
          `)}
          <p><code>field</code> is still required: it is the column's identity and value lookup, and must be unique within a table. An action cell may use a field whose value it does not render.</p>
          <p>Any column factory also accepts <code>component</code> directly. <code>Column.Custom</code> is the clearer choice for a display-only cell; the component replaces the built-in editor for that column.</p>
        </Section>
        <Section title="Reusable Column Types">
          <p>Register application-specific column factories once and reuse them through <code>TypedTable.extend</code>. Bind the cell component and any shared defaults with <code>Column.custom</code>, then pass the field and per-use options where the column is declared.</p>
          {Code.format(`
            // table-types.ts
            import { Button, CellContent, Column, TypedTable } from 'basis/react'

            class ActionsCell extends CellContent<User> {
              static displayName = 'ActionsCell'

              content() {
                return (
                  <Button onActivate={() => editUser(this.props.row)}>
                    Edit
                  </Button>
                )
              }
            }

            export const AppTable = TypedTable.extend({
              Actions: Column.custom(ActionsCell, { sortable: false })
            })

            // user-table.tsx
            const { Column, Table } = AppTable.of<User>()

            <Table value={users}>
              {Column.Text({ field: 'name', title: 'Name' })}
              {Column.Actions({ field: 'id', title: 'Actions' })}
            </Table>
          `)}
          <p>Registered factories keep their row type. A factory created for <code>User</code> is available on <code>AppTable.of&lt;User&gt;()</code> and on rows extending <code>User</code>; it is not offered for an unrelated row. Use <code>Column.custom&lt;User&gt;(...)</code> to pin the row explicitly. When the row is inferred from the cell, <code>.of&lt;Row&gt;()</code> supplies the row type at the call site.</p>
          <p>A generic cell registers a generic factory. For example, <code>Column.custom(IdCell)</code> with <code>IdCell&lt;TRow extends &#123; id: number &#125;&gt;</code> is available on every <code>.of&lt;Row&gt;()</code> whose row meets that constraint.</p>
          {Code.format(`
            class IdCell<TRow extends { id: number }> extends CellContent<TRow> {
              static displayName = 'IdCell'

              content() {
                return <span>{this.props.row.id}</span>
              }
            }

            const GenericTable = TypedTable.extend({
              Id: Column.custom(IdCell)
            })

            GenericTable.of<Project>().Column.Id({ field: 'id', title: 'ID' })
          `)}
          <p>Registered factories also keep the cell's value type when the row is inferred. A cell declared as <code>CellContent&lt;User, 'id'&gt;</code> is offered only for fields whose value is a number; <code>CellContent&lt;User&gt;</code> accepts any field. A mismatched field is a compile error. Use <code>Column.custom&lt;User&gt;(...)</code> to pin the row explicitly; the factory stays row-safe and accepts any field of that row.</p>
          <p>Built-in column factories remain available on the extended table, and per-use options override the defaults registered with the factory.</p>
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
          <p>A height-bounded table keeps its sticky header above every body row, including left- and right-pinned cells, so the header stays readable while the body scrolls vertically.</p>
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
          <p>Row selection is opt-in and always controlled. Set <code>enableRowSelection</code>, pass the current <code>selectedRows</code> as any iterable of keys, and provide <code>onStateChange</code> to receive the next <code>TableState</code>. The table renders one fixed-width, left-pinned, nonsortable checkbox column before every declared column. It never owns a second selection store.</p>
          <p>Selection keys come from the existing <code>keyField</code> (default <code>id</code>). The header selects or clears all rows in the current <code>value</code>; selected keys outside the current rows are preserved. Every displayed row is selectable, and the only disabled checkbox is the header when the table has no rows. <code>onStateChange</code> is the table interaction-state notification and is distinct from the row-data <code>onChange</code>.</p>
          <TableSelectionExample />
          {Code.format(`
            <Table
              enableRowSelection
              selectedRows={selectedRows}
              value={people}
              onStateChange={state => setSelectedRows(state.selectedRows)}
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
            <li><code>enableRowSelection?: boolean</code> - Adds the controlled selection column and header checkbox</li>
            <li><code>keyField?: PathOf&lt;T&gt;</code> - Field to use as unique row identifier (default: 'id')</li>
            <li><code>onStateChange?: (state: TableState) =&gt; void</code> - Receives the next controlled table state; required when row selection is enabled</li>
            <li><code>readOnly?: boolean</code> - Whether the table is read-only</li>
            <li><code>selectedRows?: Iterable&lt;TableKey&gt;</code> - The controlled selected row keys; required when row selection is enabled</li>
            <li><code>value: T[]</code> - Array of data to display</li>
          </ul>
          <h4>Column Props</h4>
          <ul>
            <li><code>align?: TextAlign</code> - Text alignment (Left, Right, Center)</li>
            <li><code>component?: CellComponent&lt;TRow, TField&gt;</code> - Custom cell component; accepts a Basis class extending <code>CellContent</code> or a React component with the cell props. Class cells are checked against the row and the declared field value</li>
            <li><code>enum?: Record&lt;string, string | number&gt;</code> - Enum options for Enum columns</li>
            <li><code>field: PathOf&lt;T&gt;</code> - Path to the data field (supports dot notation); also the column's unique identity within a table</li>
            <li><code>pin?: Pin</code> - Column pinning position (Left, Right, Unpinned)</li>
            <li><code>sortable?: boolean</code> - Whether the column is sortable (default: true)</li>
            <li><code>title?: ReactNode</code> - Column header content, including interactive controls (defaults to field name)</li>
            <li><code>type?: ColumnType</code> - Column type (Text, Number, Boolean, Date, DateTime, Enum, Custom)</li>
            <li><code>width?: string | number</code> - Column width</li>
          </ul>
          <p><code>Column.Custom</code> requires <code>component</code> and defaults to left alignment and name sorting. <code>ColumnType</code> is exported from <code>basis/react</code>.</p>
          <h4>Cell Content</h4>
          <ul>
            <li><code>CellContent&lt;Row, Field&gt;</code> - Base class for a custom cell; implement <code>content()</code> and read <code>this.props.row</code>, <code>value</code>, <code>field</code>, or <code>column</code></li>
            <li><code>CellProps&lt;Value, Row, Field&gt;</code> - The cell props contract</li>
            <li><code>CellComponent&lt;Row, Field&gt;</code> - The component type accepted by <code>component</code>; class cells must accept the row and field value</li>
          </ul>
          <h4>Typed Table Helpers</h4>
          <ul>
            <li><code>TypedTable.of&lt;T&gt;()</code> - The built-in column factories for row <code>T</code></li>
            <li><code>TypedTable.extend(registry)</code> - Adds reusable column factories to every compatible <code>.of&lt;T&gt;()</code> facade</li>
            <li><code>Column.custom(component, defaults?)</code> - Binds a cell component and shared defaults into a reusable, row-typed column factory; the factory preserves the cell's value type</li>
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
 * A custom display cell. The public `CellContent` base gives a Basis class cell
 * typed access to its row, value, field, and column declaration.
 */
class UserNameCell extends CellContent<User> {
  static displayName = 'UserNameCell'

  content() {
    const { email, name } = this.props.row
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
        <strong>{name}</strong>
        <small>{email}</small>
      </span>
    )
  }
}

/**
 * UserTable component - demonstrates nested data access
 */
class UserTable extends Component<{ data: User[] }> {
  static displayName = 'UserTable'

  override render(): React.ReactNode {
    const { data } = this.props
    const { Column, Table } = TypedTable.of<User>()

    return (
      <Table readOnly initialValue={data}>
        {Column.Number({ align: TextAlign.Center, field: 'id', header: true, pin: Pin.Left, title: 'ID' })}
        {Column.Custom({
          component: UserNameCell,
          field: 'name',
          pin: Pin.Left,
          sortDirection: SortDirection.Asc,
          title: 'Name',
        })}
        {Column.Text({ field: 'email', title: 'Email' })}
        {Column.Enum({ enum: UserRole, field: 'role', title: 'Role' })}
        {Column.Date({ field: 'lastLogin', title: 'Last Login' })}
        {Column.DateTime({ field: 'lastUpdated', title: 'Last Updated' })}
        {Column.Boolean({ field: 'active', title: 'Status' })}
        {Column.Text({ field: 'profile.bio', title: 'Bio' })}
      </Table>
    )
  }
}
