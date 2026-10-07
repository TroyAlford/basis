import type * as React from 'react'
import { describe, matchScreenshot, test } from '../../testing'
import { Orientation } from '../types/Orientation'
import { AutoComplete } from './AutoComplete/AutoComplete'
import { Button } from './Button/Button'
import { Carousel } from './Carousel/Carousel'
import { CheckboxEditor } from './CheckboxEditor/CheckboxEditor'
import { Documentation } from './Documentation/Documentation'
import { DropdownMenu } from './DropdownMenu/DropdownMenu'
import { EnumEditor } from './EnumEditor/EnumEditor'
import { Image } from './Image/Image'
import { Menu } from './Menu/Menu'
import { NumberEditor } from './NumberEditor/NumberEditor'
import { OptionGroup } from './OptionGroup/OptionGroup'
import { Link } from './Router/Link'
import { Section } from './Section/Section'
import { TypedTable } from './Table/TypedTable'
import { Tag } from './Tag/Tag'
import { TagsEditor } from './TagsEditor/TagsEditor'
import { TextEditor } from './TextEditor/TextEditor'
import { ToggleEditor } from './ToggleEditor/ToggleEditor'

/**
 * Per-component visual regression.
 *
 * Each component renders its meaningful states side by side, labelled, to one
 * committed snapshot, so a styling or layout change is reviewable as an image
 * diff and a missing state is obvious. Captures are static renders on the shared
 * capture page (`matchScreenshot(<Element/>)`), so the whole suite costs one
 * browser and no navigation.
 *
 * Components whose meaningful state only exists after mount — `Await` (resolved
 * content), `Mermaid` (the rendered diagram), and `Tooltip` (floating placement)
 * — are covered live in `visual.live.test.tsx`. The abstract/host components
 * (`Component`, `Editor`, `Router`, `ApplicationBase`, `Theme`,
 * `OverlayProvider`, `IndexHTML`) render nothing on their own and the imperative
 * `Dialog`/`Notification` open through static APIs, so they are exercised
 * through the components that use them.
 */

/** Antialiasing differs across machines; absorb it the way the other snapshots do. */
const TOLERANCE = { maxDiffPixelRatio: 0.01 }

/** A small, deterministic placeholder image for image-bearing components. */
const IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100">' +
  '<rect width="160" height="100" fill="#dbeafe"/><text x="80" y="54" fill="#2563eb"' +
  ' font-family="sans-serif" font-size="16" text-anchor="middle">image</text></svg>',
)}`

const GALLERY_STYLE: React.CSSProperties = {
  alignItems: 'flex-start',
  background: '#fff',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 20,
  // Room for an open popup (EnumEditor/DropdownMenu) to fall inside the capture.
  minHeight: 180,
  padding: 16,
}

const LABEL: React.CSSProperties = {
  color: '#666',
  font: '600 11px system-ui, sans-serif',
}

const CELL: React.CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  minHeight: 32,
}

const SIZED_IMAGE: React.CSSProperties = { display: 'inline-flex', height: 100, width: 160 }

const SIZED_CAROUSEL: React.CSSProperties = { display: 'inline-flex', height: 160, width: 260 }

const SIZED_EDITOR: React.CSSProperties = { display: 'inline-flex', width: 120 }

/**
 * Lay out labelled component states in a wrap row.
 * @param states - Labelled states.
 * @returns The gallery element.
 */
function gallery(states: [string, React.ReactNode][]): React.ReactElement {
  return (
    <div style={GALLERY_STYLE}>
      {states.map(([label, node]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={LABEL}>{label}</span>
          <span style={CELL}>{node}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * A minimal table for the Table snapshot.
 * @returns The table element.
 */
function Users(): React.ReactElement {
  interface User {
    active: boolean,
    email: string,
    id: number,
    name: string,
  }

  const users: User[] = [
    { active: true, email: 'ada@example.com', id: 1, name: 'Ada Lovelace' },
    { active: false, email: 'grace@example.com', id: 2, name: 'Grace Hopper' },
  ]

  const { Column, Table } = TypedTable.of<User>()
  return (
    <Table readOnly initialValue={users}>
      {Column.Number({ field: 'id', header: true, title: 'ID' })}
      {Column.Text({ field: 'name', title: 'Name' })}
      {Column.Text({ field: 'email', title: 'Email' })}
      {Column.Boolean({ field: 'active', title: 'Active' })}
    </Table>
  )
}

/**
 * The label for an autocomplete option.
 * @param option - The option.
 * @returns The option.
 */
function optionLabel(option: string): string {
  return option
}

/**
 * An empty autocomplete search.
 * @returns No options.
 */
async function noOptions(): Promise<string[]> {
  return []
}

const enumOptions = { Alpha: 'a', Beta: 'b', Gamma: 'c' }
const dropdownItems = (
  <>
    <DropdownMenu.Item>View Profile</DropdownMenu.Item>
    <DropdownMenu.Item>Settings</DropdownMenu.Item>
    <DropdownMenu.Divider />
    <DropdownMenu.Item>Logout</DropdownMenu.Item>
  </>
)
const menuItems = (
  <>
    <Menu.Item>Profile</Menu.Item>
    <Menu.Item>Settings</Menu.Item>
    <Menu.Divider />
    <Menu.Item disabled>Help</Menu.Item>
  </>
)
const optionItems = (
  <>
    <OptionGroup.Option data="a">Alpha</OptionGroup.Option>
    <OptionGroup.Option data="b">Beta</OptionGroup.Option>
  </>
)

/**
 * One labelled gallery per component, with an optional wider pixel budget.
 *
 * `OptionGroup` and `TagsEditor` size native form controls to their content, so
 * their layout tracks the host's font metrics and shifts slightly between the
 * machines that generate a baseline and the one that compares it. Their budget
 * is wider; everything else matches tightly.
 */
const COMPONENTS: [string, React.ReactElement, number?][] = [
  ['AutoComplete', gallery([
    ['closed', (
      <AutoComplete
        getOptionLabel={optionLabel}
        getOptionValue={optionLabel}
        placeholder="Search…"
        onSearch={noOptions}
      />
    )],
  ])],
  ['Button', gallery([
    ['default', <Button>Default</Button>],
    ['submit', <Button type={Button.Type.Submit}>Submit</Button>],
    ['reset', <Button type={Button.Type.Reset}>Reset</Button>],
    ['disabled', <Button disabled>Disabled</Button>],
  ])],
  ['Carousel', gallery([
    ['images', (
      <span style={SIZED_CAROUSEL}>
        <Carousel images={[IMAGE, IMAGE]} />
      </span>
    )],
  ])],
  ['CheckboxEditor', gallery([
    ['unchecked', <CheckboxEditor initialValue={false}>Unchecked</CheckboxEditor>],
    ['checked', <CheckboxEditor initialValue={true}>Checked</CheckboxEditor>],
    ['indeterminate', <CheckboxEditor allowIndeterminate initialValue={null}>Indeterminate</CheckboxEditor>],
    ['disabled', <CheckboxEditor disabled initialValue={true}>Disabled</CheckboxEditor>],
  ])],
  ['Documentation', (
    <Documentation
      active="/"
      navigation={[{ href: '/', title: 'Home' }, { href: '/guide', title: 'Guide' }]}
      title="Docs"
    >
      <h1>Home</h1>
      <p>Documentation content.</p>
    </Documentation>
  )],
  ['DropdownMenu', gallery([
    ['closed', (
      <DropdownMenu trigger="Options">{dropdownItems}</DropdownMenu>
    )],
    ['open', (
      <DropdownMenu open trigger="Options">{dropdownItems}</DropdownMenu>
    )],
  ])],
  ['EnumEditor', gallery([
    ['closed', <EnumEditor enum={enumOptions} initialValue="a" />],
    ['open', <EnumEditor open enum={enumOptions} initialValue="a" />],
  ])],
  ['Image', gallery([
    ['natural', (
      <span style={SIZED_IMAGE}>
        <Image alt="Example" src={IMAGE} />
      </span>
    )],
  ])],
  ['Link', gallery([
    ['default', <Link to="/other">Link</Link>],
    ['active', <Link active to="/current">Active</Link>],
  ])],
  ['Menu', gallery([
    ['horizontal', (
      <Menu orientation={Menu.Orientation.Horizontal}>{menuItems}</Menu>
    )],
    ['vertical', (
      <Menu orientation={Menu.Orientation.Vertical}>{menuItems}</Menu>
    )],
  ])],
  ['NumberEditor', gallery([
    ['value', <span style={SIZED_EDITOR}><NumberEditor initialValue={42} /></span>],
    ['disabled', <span style={SIZED_EDITOR}><NumberEditor disabled initialValue={7} /></span>],
  ])],
  ['OptionGroup', gallery([
    ['vertical', (
      <OptionGroup initialValue="a">{optionItems}</OptionGroup>
    )],
    ['horizontal', (
      <OptionGroup initialValue="a" orientation={Orientation.Horizontal}>{optionItems}</OptionGroup>
    )],
  ]), 0.05],
  ['Section', gallery([
    ['titled', <Section title="Section title"><p>Section content.</p></Section>],
    ['untitled', <Section><p>Section content.</p></Section>],
  ])],
  ['Table', gallery([['default', <Users />]])],
  ['Tag', gallery([
    ['default', <Tag>Label</Tag>],
    ['removable', <Tag removable>Removable</Tag>],
  ])],
  ['TagsEditor', gallery([
    ['values', <TagsEditor initialValue={['alpha', 'beta']} />],
    ['empty', <TagsEditor />],
  ]), 0.05],
  ['TextEditor', gallery([
    ['placeholder', <TextEditor placeholder="Placeholder" />],
    ['value', <TextEditor initialValue="Some text" />],
  ])],
  ['ToggleEditor', gallery([
    ['off', <ToggleEditor initialValue={false}>Off</ToggleEditor>],
    ['on', <ToggleEditor initialValue={true}>On</ToggleEditor>],
    ['disabled', <ToggleEditor disabled initialValue={true}>Disabled</ToggleEditor>],
  ])],
]

describe('components', () => {
  for (const [name, element, tolerance] of COMPONENTS) {
    test(name, async () => {
      await matchScreenshot(element, 'default', {
        maxDiffPixelRatio: tolerance ?? TOLERANCE.maxDiffPixelRatio,
      })
    })
  }
})
