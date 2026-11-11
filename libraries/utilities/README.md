# @basis/utilities

Shared functions and types used by Basis packages, with a supported `basis/utilities` consumer facade. The same primitives remain available internally through `@basis/utilities`.

The authoritative map of the internal surface is the documentation site's [Utilities page](../../docs/utilities.mdx). It covers string/naming helpers, formatting, object/path primitives, async primitives, URI/routing helpers, runtime facts, and the exported types.

```ts
kebabCase('MoonPhase') // 'moon-phase'
formatBytes(1024) // '1.00 KB'
```

`Logger` is available here internally and through its supported facade, `basis/logger`. See [Logging](../../docs/logging.mdx) for the public contract.

Internal Basis code imports this workspace package-relatively; applications import `basis/utilities` rather than a workspace or `node_modules/basis/libraries/*` path.
