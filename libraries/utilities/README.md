# @basis/utilities

## Overview

The `@basis/utilities` package offers a collection of utility functions designed to simplify common programming tasks. These functions enhance productivity by providing reusable solutions for various operations, including:

- **Data Manipulation**: Functions for cloning objects, formatting data, and managing data attributes.
- **String Operations**: Utilities for string formatting, case conversion, and deburring.
- **Type Handling**: Functions to check for null or undefined values and to perform deep equality checks.
- **URI Parsing**: Tools for parsing and manipulating URIs and template URIs.
- **Mathematical Operations**: Functions for formatting bytes and handling time durations.

## Installation

```sh
bunx jsr add @basis/utilities
```
> **Note:** All `@basis` packages, including this one, are published via `jsr` instead of `npm`. This approach ensures a streamlined and efficient package management experience tailored for Bun.

## Usage Example

This package includes various utility functions. Here are a couple of examples:

### Formatting Bytes

```ts
import { formatBytes } from '@basis/utilities';

const size = formatBytes(1024); // "1.00 KB"
```

### Cloning Objects

```ts
import { clone } from '@basis/utilities';

const original = { a: 1, b: { c: 2 } };
const copy = clone(original); // Deep clone of the object
```

### Pattern Matching with `match`

The `match` function allows for flexible pattern matching against values. Here’s an example:

```ts
import { match } from '@basis/utilities';

const result = match(5)
  .when(5).then('five')
  .when({ min: 0, max: 10 }).then('small number')
  .else('something else');

console.log(result); // Output: "five"
```
