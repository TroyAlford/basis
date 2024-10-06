# React Testing Utilities

## Overview

This directory provides utilities for testing React components, focusing on rendering and interacting with components in a test environment. The primary utility is the `render` function, which simplifies the process of rendering components and accessing their properties and methods during tests.

## Usage

### Render Function

The `render` function is a key utility for testing React components. It allows you to render a component into a DOM-like environment and provides methods to interact with the rendered output.

#### Basic Usage

To use the `render` function, import it into your test file and call it with the component you want to test:

```ts
import { render } from '../../testing/render'

class Hello extends React.Component {
  render() {
    return <div className="hello component">
      {`Hello, `}<em>{this.props.who}</em>!
    </div>
  }
}

test('renders Hello correctly', () => {
  const {
    find, // a function to find a child component by type
    findAll, // a function to find all child components by type
    instance, // the component instance (if a class component)
    node, // the rendered DOM node
    unmount // a function to unmount the component
    update, // a function to update the component
  } = render(<Hello who="World" />)

  expect(node).toBeInstanceOf(HTMLElement)
  expect(node).toHaveClass('hello', 'component')
  expect(node.textContent).toBe('Hello, World!')

  expect(instance).toBeInstanceOf(Hello)
  expect(instance.props).toMatchObject({ who: 'World' })

  expect(find('em')).toHaveTextContent('World')

  update({ who: 'Universe' })
  expect(node.textContent).toBe('Hello, Universe!')
  expect(find('em')).toHaveTextContent('Universe')
})

## Custom Matchers

The testing setup includes custom matchers to extend the default `expect` functionality, allowing for more expressive assertions. These matchers are defined in the `bun:test` module and include:

- **toHaveAttribute**: Checks if a DOM node has a specific attribute with a given value.
- **toHaveClass**: Checks if a DOM node has specific class names.

## Global Setup

The testing environment is configured using the `bunfig.toml` file to preload specific modules and enable code coverage.

### Configuration Details

To enable code coverage and set up the testing environment, ensure your `bunfig.toml` file includes the following:

- **Code Coverage**: Set `coverage` to `true` and use `lcov` for `coverageReporter` to get detailed reports.
- **Preloading Modules**: Add the following to the `preload` option:
  - `./node_modules/TroyAlford/basis/config/happydom.ts`: Sets up a DOM-like environment.
  - `./node_modules/TroyAlford/basis/libraries/react/testing/bun`: Configures the testing environment with custom matchers and global functions.

This setup ensures your tests run with the necessary configurations and utilities, allowing you to focus on writing tests.

```toml
[test]
coverage = true
coverageReporter = ["lcov"]
preload = [
  "./node_modules/TroyAlford/basis/config/happydom.ts",
  "./node_modules/TroyAlford/basis/libraries/react/testing/bun"
]
```

## Conclusion

The utilities provided in this directory are designed to streamline the process of testing React components, making it easier to write robust and maintainable tests. By using the `render` function and custom matchers, you can focus on testing the behavior and output of your components with minimal setup.

