Here's a README.md for the @basis/server workspace:

# @basis/server

## Overview

The `@basis/server` package provides a development server for live-compiling, serving, and hot reloading React applications. It's built specifically for Bun and offers features like:

- **Live Development Server**: Automatically recompiles and serves your React application during development
- **Hot Module Reloading (HMR)**: Updates your application in real-time as you make changes
- **API Route Handling**: Simple API route definition and handling
- **Asset Management**: Serves and caches static assets efficiently
- **WebSocket Support**: Built-in WebSocket support for real-time updates
- **Module Resolution**: Handles module imports and dependencies

## Installation

```sh
bunx jsr add @basis/server
```

> **Note:** All `@basis` packages, including this one, are published via `jsr` instead of `npm`. This approach ensures a streamlined and efficient package management experience tailored for Bun.

## Usage Example

Here's a basic example of setting up a development server:

```ts
import { Server } from '@basis/server'

const server = new Server()
  .root(__dirname) // Set the project root
  .assets('./assets') // Serve static assets from ./assets
  .main('./main.tsx') // Set the main entry point
  .start() // Start the server
```

### API Routes

You can define API routes with specific HTTP verbs:

```ts
import { HttpVerb } from '@basis/utilities';
import type { APIRoute } from '@basis/server';

const helloRoute: APIRoute = {
  handler: () => new Response('Hello, World!'),
  verbs: new Set([HttpVerb.Get]),
};

server.api([HttpVerb.Get], '/hello', helloRoute);
```

## Key Features

### Hot Module Reloading

The server includes built-in HMR support that:
- Watches for file changes in your source directory
- Automatically rebuilds affected modules
- Updates the browser without full page reloads
- Maintains application state during updates

### Build System

The server includes a sophisticated build system that:
- Handles TypeScript and JSX compilation
- Supports SASS/SCSS processing
- Manages source maps
- Optimizes builds for development

### API Route Handling

The server provides a flexible API route system that:
- Supports all standard HTTP verbs
- Handles route parameters
- Returns proper HTTP responses
- Includes built-in health and ping endpoints

## Configuration

The server can be configured with various options:

```ts
const server = new Server({
  // Server configuration options
}).main('./src/index.tsx')
  .start({
    port: 3000,  // Default is 80
  });
```

## Development Workflow

1. Create your React application entry point
2. Initialize the server with the entry point
3. Start the development server
4. Make changes to your code
5. See changes reflected immediately in the browser

The server handles all the complexity of:
- File watching
- Code compilation
- Module bundling
- Live reloading
- Asset serving
- API routing

This provides a seamless development experience while maintaining high performance and reliability.
