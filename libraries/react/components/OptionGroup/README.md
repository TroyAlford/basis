# OptionGroup Component

A flexible option group component that renders either radio buttons (single selection) or checkboxes (multiple selection), following the Editor pattern from the basis react library.

## Features

- **Single/Multiple Selection**: Toggle between radio buttons and checkboxes
- **Generic Type Support**: Works with any value type (string, number, etc.)
- **Controlled/Uncontrolled**: Supports both controlled and uncontrolled modes
- **Accessibility**: Proper ARIA attributes and keyboard navigation
- **Orientation**: Horizontal or vertical layout
- **Disabled Options**: Individual options can be disabled
- **Read-only Mode**: Entire component can be made read-only

## Usage

### Basic Radio Group (Single Selection)

```tsx
import { OptionGroup } from '@basis/react'

const options = [
  { value: 'public', label: 'Public' },
  { value: 'player', label: 'Player' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Storyteller' },
]

<OptionGroup
  options={options}
  multiple={false}
  value="editor"
  onChange={(value) => console.log('Selected:', value)}
/>
```

### Checkbox Group (Multiple Selection)

```tsx
const permissions = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
]

<OptionGroup
  options={permissions}
  multiple={true}
  value={['read', 'write']}
  onChange={(values) => console.log('Selected:', values)}
/>
```

### Horizontal Layout

```tsx
<OptionGroup
  options={options}
  multiple={false}
  orientation="horizontal"
  value="option1"
  onChange={handleChange}
/>
```

### Disabled Options

```tsx
const optionsWithDisabled = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2', disabled: true },
  { value: 'option3', label: 'Option 3' },
]

<OptionGroup
  options={optionsWithDisabled}
  multiple={false}
  value="option1"
  onChange={handleChange}
/>
```

### Generic Types

```tsx
const numberOptions = [
  { value: 1, label: 'One' },
  { value: 2, label: 'Two' },
  { value: 3, label: 'Three' },
]

<OptionGroup<number>
  options={numberOptions}
  multiple={false}
  value={2}
  onChange={(value: number) => console.log(value)}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `OptionProps<T>[]` | - | Array of options to display |
| `multiple` | `boolean` | `false` | Whether multiple options can be selected |
| `orientation` | `'horizontal' \| 'vertical'` | `'vertical'` | Layout orientation |
| `value` | `T \| T[]` | - | Current value(s) (controlled mode) |
| `initialValue` | `T \| T[]` | - | Initial value(s) (uncontrolled mode) |
| `onChange` | `(value: T \| T[], field: string, editor: Editor) => void` | - | Change handler |
| `readOnly` | `boolean` | `false` | Whether the component is read-only |
| `field` | `string` | - | Field identifier |
| `aria-label` | `string` | - | ARIA label for accessibility |
| `aria-labelledby` | `string` | - | ARIA labelledby for accessibility |

## Option Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `T` | - | The value for this option |
| `label` | `string` | - | Label text for this option |
| `disabled` | `boolean` | `false` | Whether this option is disabled |
| `inputProps` | `React.InputHTMLAttributes<HTMLInputElement>` | - | Additional props for the input element |

## Replacing Antd Radio Components

This component can be used as a drop-in replacement for antd Radio components:

### Before (Antd)
```tsx
import { Radio } from 'antd'

<Radio.Group onChange={handleChange} value={role}>
  <Radio.Button value="public">Public</Radio.Button>
  <Radio.Button value="player">Player</Radio.Button>
  <Radio.Button value="editor">Editor</Radio.Button>
  <Radio.Button value="owner">Storyteller</Radio.Button>
</Radio.Group>
```

### After (OptionGroup)
```tsx
import { OptionGroup } from '@basis/react'

const roleOptions = [
  { value: 'public', label: 'Public' },
  { value: 'player', label: 'Player' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Storyteller' },
]

<OptionGroup
  options={roleOptions}
  multiple={false}
  value={role}
  onChange={handleChange}
/>
```

## Keyboard Navigation

- **Arrow Keys**: Navigate between options
- **Space**: Toggle checkbox selection (multiple mode)
- **Home/End**: Jump to first/last option
- **Tab**: Focus the component

## Styling

The component uses CSS custom properties for theming. All styles are prefixed with `--basis-option-*` and can be customized through CSS variables.
