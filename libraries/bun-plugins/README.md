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

### Markdown/MDX Plugin

- Compile `.md` and `.mdx` imports into React components (`@mdx-js/mdx` + `remark-gfm`)
- Strip a leading YAML front-matter block, so it is metadata rather than page content
- Rewrite `mermaid` code fences to the `Mermaid` component from `basis/react`

## Installation

<code>
bun add -d @basis/bun-plugins
</code>

## Usage

```typescript
import { pluginGlobals, pluginMarkdown, pluginSASS } from '@basis/bun-plugins'

// SASS Plugin
const buildConfig = {
  plugins: [
    pluginSASS({
      // SASS plugin options
    })
  ]
}
// Markdown/MDX Plugin
const markdownBuildConfig = {
  plugins: [
    pluginMarkdown()
  ]
}
// Globals Plugin
const buildConfig = {
  plugins: [
    pluginGlobals({
      // Define global variables
      'Bun.env.NODE_ENV': JSON.stringify('production')
    })
  ]
}
// Combined Usage
const buildConfig = {
  plugins: [
    pluginSASS(),
    pluginGlobals({
      'Bun.env.NODE_ENV': JSON.stringify('production')
    })
  ]
}
```
