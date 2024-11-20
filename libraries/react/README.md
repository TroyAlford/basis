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

