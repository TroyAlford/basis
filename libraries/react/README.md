# @basis/react

## Overview

The `@basis/react` package provides a set of utilities and components specifically designed for Bun projects using React. This library enhances the development experience by offering reusable components and utilities that streamline common tasks in React applications.

## Features

- **React-specific utilities**: Functions and helpers tailored for React development.
- **Common components**: A collection of pre-built components to accelerate development.
- **Build optimizations**: Enhancements to improve the performance of React applications.
- **Browser-specific configurations**: Settings and utilities that cater to different browser environments.

## Core Concept

A key feature of this library is the abstract `Component` class, which serves as the base for all components within the `@basis/react` package. This class provides essential functionality, including:

- **Data attributes**: Automatically handles `data-*` attributes for components.
- **Class name management**: Simplifies the management of class names through utility functions.
- **Customizable rendering**: Allows for easy customization of the rendering process through the `content` method.

## Installation

```sh
bunx jsr add @basis/react
```

> **Note:** All `@basis` packages, including this one, are published via `jsr` instead of `npm`. This approach ensures a streamlined and efficient package management experience tailored for Bun.

## Requirements

- Bun runtime
- React 18+
- React DOM 18+

## Usage Example

This package includes various utilities and components. Here’s a brief example of how to use the `Component` class:

```tsx
import * as React from 'react';
import { Component } from '@basis/react';

class MyComponent extends Component {
  render() {
    return <div>Hello, World!</div>;
  }
}
```

In this example, `MyComponent` extends the base `Component` class, inheriting its functionality and allowing for easy integration of data attributes and class name management.

By leveraging the `@basis/react` package, developers can create robust and maintainable React applications with minimal setup.

## Utilities

### `resolveElement`

`resolveElement(value, fallback?, closestFrom?)` normalizes an element, a React ref, or a CSS selector into an `HTMLElement`. A selector is matched with `Element.closest` starting at `closestFrom`, so it names an ancestor of that element. Anything that resolves to nothing — an empty value, an unattached ref, or a selector with no match — yields the fallback (`null` when none is given).

```ts
import { resolveElement } from '@basis/react'

resolveElement(pane)                             // the element itself
resolveElement(paneRef)                          // paneRef.current
resolveElement('.scrolling-pane', null, anchor)  // nearest matching ancestor
resolveElement('.missing', null, anchor)         // null
```

The Popup mixin uses it to resolve an anchor and, for a selector `boundary`, the clipping container.

## Documentation surface

`Documentation` is the shared documentation shell — a navigation sidebar beside the page content, typed by the active theme. The docs app and the static documentation build both render through it, so a published site looks the same as the app.

```tsx
import { Documentation } from '@basis/react'
import type { DocumentationEntry } from '@basis/react'

const navigation: DocumentationEntry[] = [{ href: '/', title: 'Home' }]

<Documentation active="/" navigation={navigation} title="My docs">
  <h1>Home</h1>
</Documentation>
```

`buildDocumentationNavigation(routes)` nests a flat `{ href, title, parent? }` list by `parent`, with the roots sorted by title. The docs app and the static build both use it so navigation nests the same way everywhere.

`Mermaid` renders a Mermaid diagram, importing the runtime on mount only, so a page without diagrams never fetches it:

```tsx
import { Mermaid } from '@basis/react'

<Mermaid>{'flowchart TD\n  A[Start] --> B[Ship]'}</Mermaid>
```

Diagrams are themed from the surrounding Basis design tokens — the primary color, background, foreground, radius, and font — so they follow the active `Theme` instead of Mermaid's stock palette. Pass `variant` (`"basis"`, `"neutral"`, or `"dark"`) to pick one of the named looks; `"basis"` is the default:

```tsx
<Mermaid variant="dark">{'flowchart TD\n  A[Start] --> B[Ship]'}</Mermaid>
```

A `mermaid` code fence in a `.mdx` document compiles to this component through the Markdown build plugin (`@basis/bun-plugins`), and the static docs build inlines the same default theme so built pages match served ones.

## Default typography

Importing `@basis/react` registers a root stylesheet that applies Basis's default type — Ubuntu for UI and Fira Code for code — from Google Fonts, so components render in Basis's type without configuration. The stylesheet URL is exported as `BASIS_FONTS_URL`; `basis/testing`'s HTML renderer loads the same fonts, so component screenshots get Basis type by default.
