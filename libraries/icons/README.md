# @basis/icons

## Overview

The `@basis/icons` package provides a comprehensive, composable icon system built specifically for React applications. This library offers a flexible architecture that allows for easy creation, customization, and composition of SVG icons with support for both filled and outlined variants.

## Features

- **Composable Architecture**: Icons are built using reusable shape components (`Path`, `Circle`, `Rect`)
- **Smart Fill/Stroke System**: Automatic handling of filled vs outlined icon variants
- **Masking Support**: Built-in masking system for complex icon compositions
- **Dynamic Icon Loading**: Runtime icon resolution through the `Icon` component
- **TypeScript Support**: Full type safety and IntelliSense support
- **Accessibility**: Built-in ARIA labels and semantic markup
- **CSS Custom Properties**: Themeable through CSS variables

## Installation

```sh
bunx jsr add @basis/icons
```

> **Note:** All `@basis` packages, including this one, are published via `jsr` instead of `npm`. This approach ensures a streamlined and efficient package management experience tailored for Bun.

## Requirements

- Bun runtime
- React 19+
- React DOM 19+

## Architecture

### Core Components

The icon system is built around several key components:

#### `IconBase`
The abstract base class for all icons, providing:
- Smart SVG attribute handling
- Fill/stroke management
- Masking utilities
- Accessibility features
- Click handling

#### Shape Components
Reusable SVG shape primitives:
- **`Path`**: For complex vector paths
- **`Circle`**: For circular elements
- **`Rect`**: For rectangular elements
- **`Shape`**: Abstract base for all shapes

#### `Icon`
A type-safe dynamic icon component that resolves icons by name at compile time. Provides full IntelliSense support for icon names.

## Icon Composition Strategy

### Basic Icons
Simple icons use a single shape component:

```tsx
export class SimpleIcon extends IconBase {
  renderContent = (): React.ReactNode => (
    <Path
      d="/* shape path */"
      fill={this.props.filled}
      stroke={this.props.filled ? 0 : 10}
    />
  )
}
```

### Complex Icons with Masking
Icons with multiple elements use the masking system for proper fill behavior. The masking strategy allows you to create icons where different parts have different fill behaviors:

```tsx
export class MaskedIcon extends IconBase {
  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    // Inner shape that should be "cut out" when filled
    const innerShape = (
      <Path
        fill
        d="/* inner shape path */"
        stroke={0}
      />
    )
    
    // Create a mask from the inner shape
    const mask = this.mask('inner', innerShape)
    
    // Outer shape that uses the mask when filled
    const outerShape = (
      <Circle
        fill={filled}
        mask={filled ? mask.props.url : undefined}
        position={[0, 0]}
        radius={80}
        stroke={10}
      />
    )

    return (
      <>
        <defs>{mask}</defs>
        {outerShape}
        {!filled && innerShape}
      </>
    )
  }
}
```

**How the masking strategy works:**
- When `filled={false}`: Both shapes render normally (outlined)
- When `filled={true}`: The outer shape fills, but the inner shape creates a "cutout" effect through masking
- The mask converts the inner shape to black, creating a transparent area in the filled outer shape

### Dynamic Icons
Complex icons with runtime behavior:

```tsx
export class DynamicIcon extends IconBase<Props> {
  renderContent = (): React.ReactNode => (
    <>
      <Circle color="#1114" position={[0, 0]} radius={100} />
      <g transform={`rotate(${this.props.rotation * 100})`}>
        {this.renderDynamicPath()}
      </g>
    </>
  )
}
```

## Usage Examples

### Direct Icon Usage

```tsx
import { SimpleIcon, MaskedIcon, DynamicIcon } from '@basis/icons'

function MyComponent() {
  return (
    <div>
      <SimpleIcon filled />
      <MaskedIcon filled={false} />
      <DynamicIcon rotation={0.1} />
    </div>
  )
}
```

### Type-Safe Dynamic Icon Resolution

The `Icon` component provides compile-time type safety for icon names:

```tsx
import { Icon } from '@basis/icons'

function DynamicIcon({ iconName }: { iconName: string }) {
  // TypeScript will provide autocomplete for valid icon names
  return <Icon named="Heart" filled />
}

// TypeScript will error on invalid icon names
// return <Icon named="InvalidIcon" filled /> // ❌ Type error
```

**Benefits:**
- **Compile-time validation**: Invalid icon names cause TypeScript errors
- **IntelliSense support**: Full autocomplete for available icon names
- **No runtime overhead**: Direct icon resolution without string matching
- **Refactoring safety**: Renaming icons updates all references automatically

### Custom Styling

```css
/* CSS Custom Properties */
:root {
  --basis-icon-color: #333;
  --basis-icon-stroke: 2px;
}

.icon {
  width: 24px;
  height: 24px;
}
```

## Icon Library Organization

The icons are organized in the `icons/` directory with each icon as a separate file:

- **Basic Icons**: `Heart.tsx`, `Star.tsx`, `Plus.tsx`
- **UI Icons**: `Menu.tsx`, `Search.tsx`, `Gear.tsx`
- **Navigation**: `TriangleUp.tsx`, `TriangleDown.tsx`, `Navigation.tsx`
- **Actions**: `Edit.tsx`, `Save.tsx`, `Trash.tsx`
- **Status**: `Info.tsx`, `Warning.tsx`, `Danger.tsx`
- **Specialized**: `MoonPhase.tsx`, `Loading.tsx`, `Sort.tsx`

## Shape System

### Path Component
For complex vector graphics:
```tsx
<Path
  d="/* svg path data */"
  fill={true}
  stroke={10}
  lineCap="round"
  lineJoin="round"
/>
```

### Circle Component
For circular elements:
```tsx
<Circle
  position={[0, 0]}
  radius={50}
  fill={false}
  stroke={10}
/>
```

### Rect Component
For rectangular elements:
```tsx
<Rect
  x={-50}
  y={-50}
  width={100}
  height={100}
  fill={true}
  stroke={0}
/>
```

## Masking System

The masking system allows complex icon compositions:

```tsx
// Create a mask
const mask = this.mask('identifier', <Path d="/* shape path */" />)

// Use the mask
<Circle mask={mask.props.url} />
```

The `mask()` method automatically:
- Generates unique mask IDs
- Sets mask children to black
- Handles both single elements and fragments

## Developer Guide

### Icon Component Type Safety

The `Icon` component uses TypeScript's `keyof` operator to ensure type safety:

```tsx
// Icon.tsx implementation
type IconName = keyof typeof Icons

interface IconProps extends BaseIconProps {
  named: IconName, // Only accepts valid icon names
}
```

This means:
- **Autocomplete**: IDE will suggest all available icon names
- **Compile-time errors**: Invalid names cause TypeScript errors
- **Refactoring**: Renaming icons automatically updates all references

### Shape Component Props

All shape components (`Path`, `Circle`, `Rect`) inherit from `Shape` and support:

```tsx
interface ShapeProps {
  color?: string,        // Override the default color
  fill?: boolean,        // Whether to fill the shape
  mask?: string,         // SVG mask reference
  stroke?: number,       // Stroke width (0 to disable)
}
```

### Smart Defaults

The `IconBase` provides smart defaults through `getSvgProps()`:

```tsx
// Automatic color and stroke management
getSvgProps({
  fill: true,           // Uses var(--basis-icon-color)
  stroke: false,        // Disables stroke
  strokeWidth: 5,       // Custom stroke width
})
```

### Masking System Details

The `mask()` method handles both single elements and fragments:

```tsx
// Single element
const mask = this.mask('id', <Path d="..." />)

// Multiple elements (fragment)
const mask = this.mask('id', (
  <>
    <Path d="..." />
    <Circle radius={10} />
  </>
))
```

## Best Practices

1. **Use Shape Components**: Always use `Path`, `Circle`, or `Rect` instead of raw SVG elements
2. **Leverage Fill System**: Use boolean `fill` props for automatic color management
3. **Disable Stroke When Needed**: Use `stroke={0}` to disable stroke
4. **Use Masking for Complex Icons**: When icons have multiple elements that need different fill behavior
5. **Provide Display Names**: Always set `static displayName` for debugging
6. **Use Data Attributes**: Add `data-name` attributes for easier debugging
7. **Type Safety**: Use the `Icon` component for dynamic icon resolution with full type safety

## Contributing

When adding new icons:

1. Create a new file in the `icons/` directory
2. Extend `IconBase` and implement `renderContent()`
3. Export the icon in `icons/icons.ts`
4. Follow the established patterns for fill/stroke handling
5. Test both filled and outlined variants

This icon system provides a powerful, flexible foundation for building consistent, accessible, and maintainable icon libraries.
