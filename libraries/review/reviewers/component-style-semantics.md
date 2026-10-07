---
id: component-style-semantics
title: Component style semantics
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - related-tests
  - repository-search
detectors: []
outcomes:
  - category: state-semantics
    disposition: finding
    destructive: false
  - category: synthetic-accessibility
    disposition: finding
    destructive: false
  - category: shared-typed-state
    disposition: finding
    destructive: false
  - category: nesting-ownership
    disposition: finding
    destructive: false
  - category: cross-component-coupling
    disposition: question
    destructive: false
  - category: clear
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Component style semantics

This reviewer owns the contextual meaning of Basis component styling: what a class or selector communicates, and whether transient state is expressed with a semantic the platform or the accessibility tree already provides. It exists because those judgments depend on the element, the surrounding component, and repository usage, not on syntax alone.

It applies to component CSS and the component code that produces the classes, attributes, roles, and `data-*` values the CSS selects on. In Basis, component styles live in `*.styles.ts` as `css` tagged templates registered through `style(...)`.

## This reviewer complements deterministic lint

Stylelint already owns the mechanical part of the contract, and this reviewer must not restate it. In particular, do **not** report:

- parse errors, unknown properties, malformed selectors, or unknown at-rules;
- declaration, custom-property, or ordering violations;
- duplicate declarations, duplicate selectors, or shorthand overrides;
- element/type-selector casing;
- non-canonical nesting that the deterministic ownership rule already reports (redundant unary branches, or repeated owners that should be factored);
- state class names that the deterministic forbidden-vocabulary rule already rejects.

If the deterministic lint already reports the exact violation, produce no finding here. The value of this reviewer is the judgment the rules cannot make: whether an unmapped class still encodes transient state, which semantic hook is the right one (native, accessibility, or `data-*`), whether an ARIA attribute is genuine or invented for styling, whether one finite value contract is duplicated across TypeScript and CSS, whether nesting and ownership are appropriate, and whether a selector couples one component to another component's internals.

## Classes are stable identity; state is not a class

Classes should represent stable component and structural identity, for example `.button.component`, `.editor.component`, `.value`, `.prefix`, `.suffix`, and other genuine DOM structure. They are not the place for transient state or variants.

Express state with, in order of preference:

1. the native platform semantic, when one exists (`:disabled`, `:checked`, `:focus-visible`, `[hidden]`, `[readonly]`, `[aria-expanded]` on a real disclosure control);
2. a genuine accessibility semantic the element actually has — using an ARIA or native attribute as a selector is correct when it already represents the element's real semantics;
3. `data-*` for application state and variants that have no corresponding native or accessibility semantic.

## Do not invent accessibility semantics for styling

Never add an ARIA attribute, role, or other accessibility semantic merely so CSS has something to select. Accessibility attributes change the accessibility tree and must describe real semantics. When there is no genuine accessibility meaning, `data-*` is the correct styling hook.

## Share one typed source for finite `data-*` values

When a finite semantic `data-*` value is emitted by TypeScript and consumed by CSS, prefer a single typed source of truth — an enum or typed constant imported by both the component and the stylesheet — over duplicating the string literal in TSX and independently in CSS. A stringly-typed contract drifts silently when one side changes.

## Scope and nesting

Component CSS should normally remain scoped beneath its owning component. State, pseudo, child, and descendant selectors should be nested under their owning selector when such an owner exists, rather than repeating the owner at top level.

Genuine stylesheet-level constructs are legitimate and should not be flagged: `:root`, global resets and primitives, design-token declarations, keyframes, and other intentional non-component scopes that have no single owner.

Prefer an existing Basis component or mixin semantic hook over inventing a parallel class or `data-*` convention.

## Do not couple to another component's internals

A selector may style a child it explicitly owns. A selector that reaches through another component's private or internal DOM structure turns that component's implementation into an accidental public contract. Ask the author a question rather than filing a finding: the coupling may be deliberate, but it should be an explicit, owned relationship or rely on a supported hook.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it should give. These examples are part of the reviewer instructions.

### State class instead of `data-*`

```css
.dialog.open {
  display: block;
}
```

Expected: `finding / state-semantics`

Expected review feedback:

> `.open` is transient state expressed as a class. Keep `.dialog.component` as the stable identity and select the state with `[data-open="true"]`; if the component does not already expose it, emit that attribute.
>
> When the class name is already in the deterministic forbidden vocabulary, Stylelint owns that finding — apply this judgment to state semantics the vocabulary does not cover.

Correct:

```css
.dialog.component {
  &[data-open="true"] {
    display: block;
  }
}
```

Expected: `no_finding`

### Legitimate structural class

```css
.editor.component > .value {
  white-space: nowrap;
}
```

`.value` is genuine DOM structure of the editor, not transient state.

Expected: `no_finding`

Expected review feedback: none.

### Genuine accessibility semantic used as a selector

```tsx
<button aria-expanded={isOpen} onClick={toggle}>
  Details
</button>
```

```css
.disclosure.component {
  &[aria-expanded="true"] > .content {
    display: block;
  }
}
```

The button really is an expandable disclosure, so `aria-expanded` is genuine.

Expected: `no_finding`

Expected review feedback: none.

### Accessibility invented only for styling

```tsx
<div aria-selected={isActive} data-testid="option">
  {label}
</div>
```

```css
.option.component[aria-selected="true"] {
  font-weight: bold;
}
```

The element is not a selectable widget and carries no real selection semantic; `aria-selected` was added so CSS could select the active row.

Expected: `finding / synthetic-accessibility`

Expected review feedback:

> `aria-selected` claims a selection semantic this element does not have; it was added as a styling hook. Use `data-active` (or another `data-*` state) instead, and remove the ARIA attribute unless the element genuinely exposes selection.

### Duplicated stringly-typed state contract

```tsx
<div data-state="loading">Loading…</div>
```

```css
.auto-complete.component > [data-state="loading"] {
  font-style: italic;
}
```

The finite value `"loading"` is written independently in TypeScript and CSS.

Expected: `finding / shared-typed-state`

Expected review feedback:

> `"loading"` is part of a finite state contract spelled independently in TSX and CSS. Define it once (for example a `Status` enum) and consume that shared value in both places so the two cannot drift.

Correct:

```ts
enum Status {
  Error = 'error',
  Loading = 'loading',
}
```

```tsx
<div data-state={Status.Loading}>Loading…</div>
```

```css
.auto-complete.component > [data-state="${Status.Loading}"] {
  font-style: italic;
}
```

Expected: `no_finding`

### Ownership and nesting

Avoidable top-level chain:

```css
.card.component:hover {
  box-shadow: var(--basis-shadow-md);
}

.card.component > .title {
  font-weight: 600;
}
```

Expected: `finding / nesting-ownership`

Expected review feedback:

> These selectors repeat the owning component at the top level. Nest the state and the child under `.card.component` so the stylesheet has one owner.

Correct:

```css
.card.component {
  &:hover {
    box-shadow: var(--basis-shadow-md);
  }

  > .title {
    font-weight: 600;
  }
}
```

Expected: `no_finding`

### Cross-component coupling

Styled as an owned structural child:

```css
.menu.component > .menu-item.component {
  cursor: pointer;
}
```

Expected: `no_finding`

Reaching through another component's internals:

```css
.dropdown-menu.component .text-editor .value {
  padding: 0;
}
```

`.text-editor` and `.value` are another component's private structure; the dropdown menu is coupling to an implementation it does not own.

Expected: `question / cross-component-coupling`

Expected review feedback:

> This reaches through `TextEditor`'s internal DOM from `DropdownMenu`. If the relationship is intentional, express it through an owned or supported hook (a class, `data-*`, or mixin attribute) rather than coupling to another component's private structure. If the styling belongs to `TextEditor`, move it there.
