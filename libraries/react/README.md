# @basis/react

Class-based React components, editors, mixins, router, theme, icons, and testing helpers. Consumers import the supported facade as `basis/react` (and icons from `basis/react/icons`) from a pinned Basis Git dependency.

```bash
bun add --dev --trust github:TroyAlford/basis#vX.Y.Z
```

```tsx
import { Button, Component, Theme } from 'basis/react'

interface Props {
  name: string,
}

export class Hello extends Component<Props> {
  static displayName = 'Hello'

  content() {
    return <Button>Hello, {this.props.name}!</Button>
  }
}

<Theme><Hello name="Basis" /></Theme>
```

All UI extends the Basis `Component` or `Editor` hierarchy. Application code must not introduce function components, hooks, or direct `React.Component` subclasses; `basis compliance` enforces that boundary. Components use `data-*` state and theme variables rather than ad-hoc state classes.

The documentation site is the authoritative component reference, with interactive examples for each component. Start at the docs home [`docs/index.mdx`](../../docs/index.mdx), then use the React sections of the site navigation. Architecture invariants live in [`docs/architecture.mdx`](../../docs/architecture.mdx), and engineering guidance lives in [`docs/engineering-principles.mdx`](../../docs/engineering-principles.mdx).

The shared documentation shell, navigation builder, Mermaid renderer, and default typography remain exported from `basis/react`. `buildDocumentationNavigation` preserves caller order and supports non-clickable section headings; it never sorts the supplied routes.
