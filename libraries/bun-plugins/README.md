# @basis/bun-plugins

Build plugins for the Bun runtime, providing enhanced build capabilities.

## Features

### SASS/SCSS Plugin
- Full SASS/SCSS compilation support
- Source map generation
- Import resolution
- Nested imports handling

### Globals Plugin
- Inject global variables during build
- Environment-specific configuration
- Type-safe variable injection
- Development/production modes

## Installation

<code>
bun add -d @basis/bun-plugins
</code>

## Usage

```typescript
import { pluginGlobals, pluginSASS } from '@basis/bun-plugins'

// SASS Plugin
const buildConfig = {
  plugins: [
    pluginSASS({
      // SASS plugin options
    })
  ]
}
// Globals Plugin
const buildConfig = {
  plugins: [
    pluginGlobals({
      // Define global variables
      'process.env.NODE_ENV': JSON.stringify('production')
    })
  ]
}
// Combined Usage
const buildConfig = {
  plugins: [
    pluginSASS(),
    pluginGlobals({
      'process.env.NODE_ENV': JSON.stringify('production')
    })
  ]
}
```
