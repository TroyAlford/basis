# `@basis/stylelint-plugin`

The Basis-owned CSS lint surface for `*.styles.ts`. It bundles the shared Stylelint configuration and the Basis-specific rules so consumers do not copy Stylelint dependencies, custom syntax, or configuration.

Basis consumes this surface through `basis/stylelint`; external consumers should do the same rather than importing this workspace directly.

## What it parses

Styles are parsed with [`postcss-styled-syntax`](https://github.com/hudochenkov/postcss-styled-syntax), a maintained template-literal custom syntax. It understands the `css` tagged templates in TypeScript, nested CSS, and `${...}` interpolations inside selectors and values. The deprecated generic `postcss-css-in-js` path is intentionally not used.

## Configuration

`createConfig` returns a Stylelint `Config` with the Basis policy:

```ts
import { createConfig } from 'basis/stylelint'

export default createConfig({
  rules: { 'basis/no-state-classes': [true, { ignore: ['open'] }] },
})
```

The zero-argument default export is the same configuration. `BASE_RULES` is the policy object on its own, exported for tests and tooling.

Ordering and structure use established plugins rather than home-grown rules: [`stylelint-order`](https://github.com/hudochenkov/stylelint-order) supplies deterministic custom-property and declaration ordering, and declarations are required to precede nested selector blocks.

## Basis rules

### `basis/no-state-classes`

Forbids representing component state and variants with ad-hoc state classes. The rule owns exactly one deterministic claim: this class name is transient state and should not be a class. It cannot know an element's real accessibility semantics from CSS, so it never recommends an ARIA attribute or role.

Each rejected class reports a deterministic recommendation:

- genuinely CSS-native state stays native (`:hover`, `:focus`, `:focus-visible`, `[hidden]`);
- application state recommends a neutral `data-*` attribute (for example `.active` → `[data-active]`, `.selected` → `[data-selected]`, `.clickable` → `[data-clickable]`);
- states where a native element semantic may apply — `disabled`, `checked`, `invalid`, `read-only` — recommend the native semantic when the element supports it, otherwise `data-*`.

Choosing an existing genuine native/ARIA semantic as the better selector is the semantic reviewer's job (`component-style-semantics`), not this rule's, because it depends on the element and cannot be decided from CSS alone.

The default vocabulary is the explicit Basis policy:

`active`, `checked`, `clickable`, `closed`, `collapsed`, `disabled`, `dragging`, `editing`, `expanded`, `focused`, `hidden`, `hover`, `hovered`, `invalid`, `loading`, `open`, `pressed`, `read-only`, `readonly`, `selected`, `visible`.

Secondary options:

- `ignore` — state class names (with or without a leading dot) to permit.

Structural, component, and mixin classes are unaffected; only the vocabulary above is rejected.

### `basis/no-avoidable-nesting`

Requires `*.styles.ts` stylesheets to be in **canonical ownership form**, and autofixes them when they are not. The selector tree is normalized so nesting exists only where an owner carries declarations or branches.

- **Flatten redundant unary branches.** A declaration-less rule with a single child is merged into that child, concatenating the selectors: `> ul { > li { ... } }` becomes `> ul > li { ... }`, and `&:hover { > .link { ... } }` becomes `&:hover > .link { ... }`.
- **Factor repeated owners.** Sibling rules that share a leading owner are grouped under it — `.header > .title { ... }` with `.header > .title:hover { ... }` becomes `.header { > .title { ... &:hover { ... } } }` — and a shared owner in a selector list is factored: `p:first-child, p:last-child` becomes `p { &:first-child, &:last-child { ... } }`.
- **Coalesce identical siblings.** Sibling rules whose complete bodies are identical are merged into one selector list rather than duplicating the body: `&, > .editor { ... }` with `> .editor > .value { ... }` becomes `&, > .editor, > .editor > .value { ... }`.
- **Protect the component root.** A top-level `.{kebab-case}.component` rule is the component stylesheet's non-compressible anchor: it survives even with a single child (`.button.component { &:hover { ... } }`, never `.button.component:hover { ... }`), and other top-level `.button.component…` selectors factor into it. Non-component stylesheets have no such anchor, so a lone flat `.foo.component:hover` stays flat.
- **Leave owner-relative and reverse selectors intact** (`&:hover`, `> .child`, `[disabled] &`, `.theme &`, `*:has(> &)`), and skip scopes that contain `${...}` interpolations.

## Tests

The rules and the parsing contract are covered under `libraries/stylelint-plugin/*.test.ts`. Fixtures run through the same `postcss-styled-syntax` custom syntax consumers use, covering nested CSS, tagged templates, interpolations, structural classes, native/ARIA/`data-*` state selectors, invalid state classes, and autofixable ordering.
