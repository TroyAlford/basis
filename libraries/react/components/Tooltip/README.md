# Tooltip Component

The Tooltip component provides tooltip functionality with proper positioning using Floating UI.

## Components

### Class-based Tooltip (Legacy)

The original class-based `Tooltip` component that extends `Component` and uses the `Popup` mixin.

```tsx
import { Tooltip } from '@basis/react/components/Tooltip'

<Tooltip placement="top" animationDuration=".2s">
  Tooltip Content!
</Tooltip>
```

### FloatingTooltip (Recommended)

A functional component that uses Floating UI for accurate positioning in all directions.

```tsx
import { FloatingTooltip } from '@basis/react/components/Tooltip'

<FloatingTooltip 
  content="This is a tooltip with Floating UI positioning"
  placement="top"
  offsetDistance={8}
>
  <button>Hover me</button>
</FloatingTooltip>
```

### useTooltip Hook

A custom hook that provides all the Floating UI functionality for building custom tooltip implementations.

```tsx
import { useTooltip } from '@basis/react/components/Tooltip'

function CustomTooltip() {
  const { 
    isOpen, 
    floatingStyles, 
    getReferenceProps, 
    getFloatingProps 
  } = useTooltip('top', 8)

  return (
    <>
      <div {...getReferenceProps()}>
        <button>Hover me</button>
      </div>
      {isOpen && (
        <div 
          {...getFloatingProps()}
          style={floatingStyles}
          className="custom-tooltip"
        >
          Custom tooltip content
        </div>
      )}
    </>
  )
}
```

## Props

### FloatingTooltip Props

- `children`: The element that triggers the tooltip
- `content`: The tooltip content to display
- `placement`: Tooltip placement relative to the reference element
- `offsetDistance`: Distance between tooltip and reference element (default: 8)
- `animationDuration`: CSS animation duration (default: '.125s')
- `visible`: Whether tooltip is visible ('auto', true, or false)

### Placement Options

The tooltip supports all standard Floating UI placements:

- `top`, `top-start`, `top-end`
- `bottom`, `bottom-start`, `bottom-end`
- `left`, `left-start`, `left-end`
- `right`, `right-start`, `right-end`

## Features

- **Accurate Positioning**: Uses Floating UI for precise positioning that automatically adjusts to viewport boundaries
- **Accessibility**: Proper ARIA roles and keyboard navigation support
- **Responsive**: Automatically flips and shifts to stay within viewport
- **Performance**: Efficient positioning updates with autoUpdate
- **Flexible**: Can be used as a component or hook for custom implementations

## Migration from Legacy Tooltip

If you're using the old class-based Tooltip with `anchorPoint`, you can migrate to the new Floating UI version:

```tsx
// Old way
<Tooltip anchorPoint="top">
  Content
</Tooltip>

// New way
<FloatingTooltip content="Content" placement="top">
  <div>Reference element</div>
</FloatingTooltip>
```

The new implementation provides better positioning, accessibility, and performance while maintaining the same visual appearance.
