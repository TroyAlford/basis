import * as React from 'react'
import { Button } from '@basis/react'
import { Code } from '../components/Code'

interface State {
  buttonType: string,
  selectedValue: string | null,
}

export class ButtonDocs extends React.Component<unknown, State> {
  state: State = {
    buttonType: 'button',
    selectedValue: null as string | null,
  }

  handleButtonClick = (event: React.SyntheticEvent): void => {
    const target = event.currentTarget as HTMLButtonElement
    const value = target.dataset.value
    if (value) {
      this.setState({ selectedValue: value })
    }
  }

  handleTypeChange = (event: React.SyntheticEvent): void => {
    const target = event.currentTarget as HTMLButtonElement
    const value = target.dataset.value
    if (value) {
      this.setState({ buttonType: value })
    }
  }

  render(): React.ReactNode {
    const { buttonType, selectedValue } = this.state

    return (
      <>
        <h1>Button</h1>
        <section>
          <p>
            The Button component provides a unified interaction pattern that handles both mouse clicks
            and keyboard navigation automatically. Built on the Component base class, it delivers
            predictable structure, excellent TypeScript ergonomics, and first-class accessibility
            out of the box.
          </p>
          <p>
            Every Button automatically supports Enter and Space key activation, includes proper
            ARIA attributes, and follows the library's design principles for consistent behavior
            across your application.
          </p>
        </section>
        <section>
          <h3>Basic Usage</h3>
          <p>
            Buttons work with a single <code>onActivate</code> handler that responds to both
            clicks and keyboard events:
          </p>
          <div className="button-examples">
            <Button onActivate={() => alert('Button activated!')}>Click or Press Enter</Button>
            <Button disabled onActivate={() => alert('Button activated!')}>Disabled Button</Button>
          </div>
          {Code.format(`
            <Button onActivate={() => alert('Button activated!')}>
              Click or Press Enter
            </Button>
            
            <Button disabled onActivate={() => alert('Button activated!')}>
              Disabled Button
            </Button>
          `, 'tsx')}
        </section>
        <section>
          <h3>Button Types</h3>
          <p>
            Buttons support the standard HTML button types. The type determines the default
            behavior in forms and other contexts:
          </p>
          <div className="button-examples">
            <Button data-value="button" type={Button.Type.Button} onActivate={this.handleTypeChange}>
              Button (default)
            </Button>
            <Button data-value="submit" type={Button.Type.Submit} onActivate={this.handleTypeChange}>
              Submit
            </Button>
            <Button data-value="reset" type={Button.Type.Reset} onActivate={this.handleTypeChange}>
              Reset
            </Button>
          </div>
          <p>Current type: <strong>{buttonType}</strong></p>
          {Code.format(`
            import { Button } from '@basis/react'

            // Available types
            Button.Type.Button   // Default button behavior
            Button.Type.Submit   // Form submission
            Button.Type.Reset    // Form reset

            <Button type={Button.Type.Submit}>
              Submit Form
            </Button>
          `, 'tsx')}
        </section>
        <section>
          <h3>Accessibility Features</h3>
          <p>
            The Button component automatically handles accessibility concerns:
          </p>
          <ul>
            <li>
              <strong>Keyboard Navigation:</strong> Supports Enter and Space key activation
              for screen readers and keyboard-only users
            </li>
            <li>
              <strong>Event Handling:</strong> Properly prevents default behavior and stops
              event propagation to avoid conflicts
            </li>
            <li>
              <strong>Semantic HTML:</strong> Renders as a proper <code>&lt;button&gt;</code> element
              with correct type attributes
            </li>
          </ul>
        </section>
        <section>
          <h3>Component Architecture</h3>
          <p>Button extends the Component base class, which provides:</p>
          <ul>
            <li>
              <strong>Consistent Structure:</strong> All buttons follow the same pattern
              for props, state, and lifecycle management
            </li>
            <li>
              <strong>Type Safety:</strong> Full TypeScript support with proper prop
              validation and default values
            </li>
            <li>
              <strong>Styling Integration:</strong> Automatic CSS class generation
              following the library's naming conventions
            </li>
            <li>
              <strong>Extensibility:</strong> Easy to extend with additional functionality
              while maintaining the core interface
            </li>
          </ul>
        </section>
        <section>
          <h2>Best Practices</h2>
          <h3>Single Handler with Data Attributes</h3>
          <p>
            Instead of creating individual handlers for each button, use a single handler
            that reads the <code>data-value</code> attribute from the clicked button.
            This pattern reduces code duplication and makes your components more maintainable.
          </p>
          <div className="button-examples">
            <Button data-value="option1" onActivate={this.handleButtonClick}>Option 1</Button>
            <Button data-value="option2" onActivate={this.handleButtonClick}>Option 2</Button>
            <Button data-value="option3" onActivate={this.handleButtonClick}>Option 3</Button>
          </div>
          <p>Selected value: <strong>{selectedValue || 'None'}</strong></p>
          <h3>Code Example</h3>
          {Code.format(`
            // Instead of this (not recommended):
            <Button onActivate={() => handleOption1()}>Option 1</Button>
            <Button onActivate={() => handleOption2()}>Option 2</Button>
            <Button onActivate={() => handleOption3()}>Option 3</Button>

            // Use this pattern (recommended):
            <Button data-value="option1" onActivate={this.handleButtonClick}>Option 1</Button>
            <Button data-value="option2" onActivate={this.handleButtonClick}>Option 2</Button>
            <Button data-value="option3" onActivate={this.handleButtonClick}>Option 3</Button>

            // With a single handler:
            handleButtonClick = (event: React.SyntheticEvent): void => {
              const target = event.currentTarget as HTMLButtonElement
              const value = target.dataset.value
              if (value) {
                // Handle the value
                this.setState({ selectedValue: value })
              }
            }
          `, 'tsx')}
          <h3>Benefits</h3>
          <ul>
            <li>Reduces the number of handler functions</li>
            <li>Makes it easier to add new options</li>
            <li>Centralizes logic in one place</li>
            <li>Follows modern React patterns</li>
            <li>Improves maintainability</li>
            <li>Built-in accessibility support</li>
            <li>Unified keyboard and mouse interaction</li>
            <li>Consistent with library design principles</li>
          </ul>
        </section>
      </>
    )
  }
}
