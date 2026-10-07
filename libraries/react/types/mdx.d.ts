/* eslint-disable @basis/no-default-export */
declare module '*.md' {
  import type * as React from 'react'
  const Component: React.ComponentType<Record<string, unknown>>
  export default Component
}

declare module '*.mdx' {
  import type * as React from 'react'
  const Component: React.ComponentType<Record<string, unknown>>
  export default Component
}
