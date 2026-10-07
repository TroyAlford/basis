import type * as React from 'react'
import { describe, matchScreenshot, test } from '../../testing'
import { AutoComplete } from './AutoComplete/AutoComplete'
import { Await } from './Await/Await'
import { Button } from './Button/Button'
import { Carousel } from './Carousel/Carousel'
import { CheckboxEditor } from './CheckboxEditor/CheckboxEditor'
import { Documentation } from './Documentation/Documentation'
import { DropdownMenu } from './DropdownMenu/DropdownMenu'
import { EnumEditor } from './EnumEditor/EnumEditor'
import { Image } from './Image/Image'
import { Menu } from './Menu/Menu'
import { Mermaid } from './Mermaid/Mermaid'
import { NumberEditor } from './NumberEditor/NumberEditor'
import { OptionGroup } from './OptionGroup/OptionGroup'
import { Link } from './Router/Link'
import { Section } from './Section/Section'
import { TypedTable } from './Table/TypedTable'
import { Tag } from './Tag/Tag'
import { TagsEditor } from './TagsEditor/TagsEditor'
import { TextEditor } from './TextEditor/TextEditor'
import { ToggleEditor } from './ToggleEditor/ToggleEditor'
import { Tooltip } from './Tooltip/Tooltip'

/**
 * Per-component visual regression.
 *
 * Each component renders once to a committed snapshot so a styling or layout
 * change is reviewable as an image diff. Captures are static renders on the
 * shared capture page (`matchScreenshot(<Element/>)`), so the whole suite costs
 * one browser and no navigation.
 *
 * Components that render nothing on their own (the abstract `Component`/`Editor`
 * bases, the `Router`/`ApplicationBase`/`Theme`/`OverlayProvider` hosts, and the
 * imperative `Dialog`/`Notification`) are exercised through the components that
 * use them rather than rendered in isolation.
 */

/** Antialiasing differs across machines; absorb it the way the other snapshots do. */
const TOLERANCE = { maxDiffPixelRatio: 0.01 }

/** A small, deterministic placeholder image for image-bearing components. */
const IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100">' +
  '<rect width="160" height="100" fill="#dbeafe"/><text x="80" y="54" fill="#2563eb"' +
  ' font-family="sans-serif" font-size="16" text-anchor="middle">image</text></svg>',
)}`

/**
 * Frame a component on a white page so the capture is a stable, padded image.
 * @param children - The component to frame.
 * @returns The framed element.
 */
function frame(children: React.ReactNode): React.ReactElement {
  return (
    <div style={{ background: '#fff', display: 'inline-flex', gap: 12, padding: 16 }}>
      {children}
    </div>
  )
}

/**
 * A minimal table for the {@link Table} snapshot.
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

/** One representative render per component. */
const COMPONENTS: [string, React.ReactElement][] = [
  ['AutoComplete', frame(
    <AutoComplete
      getOptionLabel={optionLabel}
      getOptionValue={optionLabel}
      placeholder="Search…"
      onSearch={noOptions}
    />,
  )],
  ['Await', frame(<Await fallback={<span>Loading…</span>}>{Promise.resolve(<span>Loaded</span>)}</Await>)],
  ['Button', frame(
    <>
      <Button>Default</Button>
      <Button type={Button.Type.Submit}>Submit</Button>
      <Button disabled>Disabled</Button>
    </>,
  )],
  ['Carousel', frame(<div style={{ height: 160, width: 260 }}><Carousel images={[IMAGE, IMAGE]} /></div>)],
  ['CheckboxEditor', frame(<CheckboxEditor initialValue={true}>Checked</CheckboxEditor>)],
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
  ['DropdownMenu', frame(
    <DropdownMenu trigger={<Button>Open menu</Button>}>
      <Menu>
        <Menu.Item>One</Menu.Item>
        <Menu.Item>Two</Menu.Item>
      </Menu>
    </DropdownMenu>,
  )],
  ['EnumEditor', frame(<EnumEditor enum={{ Alpha: 'a', Beta: 'b' }} initialValue="a" />)],
  ['Image', frame(<div style={{ height: 100, width: 160 }}><Image alt="Example" src={IMAGE} /></div>)],
  ['Link', frame(<Link to="/example">Example link</Link>)],
  ['Menu', frame(
    <Menu orientation={Menu.Orientation.Horizontal}>
      <Menu.Item>One</Menu.Item>
      <Menu.Item>Two</Menu.Item>
    </Menu>,
  )],
  ['Mermaid', frame(<Mermaid>{'flowchart LR\n  A[Start] --> B[End]'}</Mermaid>)],
  ['NumberEditor', frame(<NumberEditor initialValue={42} />)],
  ['OptionGroup', frame(
    <OptionGroup initialValue="a">
      <OptionGroup.Option data="a">Alpha</OptionGroup.Option>
      <OptionGroup.Option data="b">Beta</OptionGroup.Option>
    </OptionGroup>,
  )],
  ['Section', frame(<Section title="Section title"><p>Section content.</p></Section>)],
  ['Table', frame(<Users />)],
  ['Tag', frame(
    <>
      <Tag>Label</Tag>
      <Tag removable>Removable</Tag>
    </>,
  )],
  ['TagsEditor', frame(<TagsEditor initialValue={['alpha', 'beta']} />)],
  ['TextEditor', frame(<TextEditor initialValue="Some text" />)],
  ['ToggleEditor', frame(<ToggleEditor initialValue={true}>Toggle</ToggleEditor>)],
  ['Tooltip', (
    <div style={{ background: '#fff', height: 100, padding: 24, position: 'relative', width: 200 }}>
      <Tooltip visible>Tooltip content</Tooltip>
    </div>
  )],
]

describe('components', () => {
  for (const [name, element] of COMPONENTS) {
    test(name, async () => {
      await matchScreenshot(element, 'default', TOLERANCE)
    })
  }
})
