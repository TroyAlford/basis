import * as React from 'react'
import { Code } from '../components/Code'

export class RouterDocs extends React.Component {
  render(): React.ReactNode {
    return (
      <>
        <h1>Router</h1>
        <section>
          <p>
            The Router component provides client-side routing capabilities for single-page applications.
            Built on the Component base class, it delivers predictable routing behavior, excellent
            TypeScript ergonomics, and seamless integration with the browser's history API.
          </p>
          <p>
            Router works together with Link components to create a complete navigation system that
            handles both programmatic navigation and user interactions while maintaining proper
            browser history state.
          </p>
        </section>
        <section>
          <h3>Basic Usage</h3>
          <p>
            Router uses a declarative approach where you define routes as children. Each route
            can be static or dynamic with parameters:
          </p>
          {Code.format(`
            <Router>
              <Router.Switch>

                <Router.Route template="/">
                  <HomePage />
                </Router.Route>

                <Router.Route template="/users/:id">
                  {params => <UserProfile id={params.id} />}
                </Router.Route>

                <Router.Route template="/admin/users/:id/edit">
                  {params => <EditUser id={params.id} />}
                </Router.Route>

                <Router.Route template="/admin/users/:id">
                  {params => <UserProfile id={params.id} />}
                </Router.Route>

                <Router.Route template="/admin">
                  <AdminDashboard />
                </Router.Route>

                <Router.Route template="/about">
                  <AboutPage />
                </Router.Route>

              </Router.Switch>
            </Router>
          `, 'tsx')}
        </section>
        <section>
          <h3>Router Components</h3>
          <p>
            The Router system consists of several components that work together to provide
            complete routing functionality:
          </p>
          <h4>Router</h4>
          <p>
            The main container component that manages routing state and renders the matching route.
            It automatically handles browser history integration and route matching.
          </p>
          <h4>Switch</h4>
          <p>
            Ensures only the first matching route renders. In the example above, if a user
            visits <code>/admin/users/123/edit</code>, only the <code>EditUser</code> component
            will render, not the <code>UserProfile</code> component, even though both routes match.
          </p>
          <h4>Route</h4>
          <p>
            Defines a route with a template pattern and content to render. Routes can accept
            either React components or functions that receive route parameters. The example above
            shows both patterns:
          </p>
          <ul>
            <li><strong>Component routes:</strong>
              <ul>
                <li><code>/</code></li>
                <li><code>/about</code></li>
                <li><code>/admin</code></li>
              </ul>
            </li>
            <li><strong>Function routes:</strong>
              <ul>
                <li><code>/users/:id</code></li>
                <li><code>/admin/users/:id</code></li>
                <li><code>/admin/users/:id/edit</code></li>
              </ul>
            </li>
            <li><strong>Route hierarchy:</strong> Define more specific routes before general ones</li>
          </ul>
          <h4>Link</h4>
          <p>
            Provides declarative navigation between routes. Links automatically track their
            active state and integrate with the browser's history:
          </p>
          {Code.format(`
            <Router.Link to="/dashboard">Dashboard</Router.Link>
            <Router.Link to="/users/123">User Profile</Router.Link>
          `, 'tsx')}
        </section>
        <section>
          <h3>Route Templates</h3>
          <p>
            Routes support both static paths and dynamic parameters using a simple template syntax.
            The example above demonstrates all three types:
          </p>
          <ul>
            <li>
              <strong>Static Routes:</strong>
              <ul>
                <li><code>/</code></li>
                <li><code>/about</code></li>
                <li><code>/admin</code></li>
              </ul>
            </li>
            <li>
              <strong>Dynamic Routes: </strong>
              <code>/users/:id</code> - parameters are extracted and passed to the route handler
            </li>
            <li>
              <strong>Nested Routes:</strong>
              <ul>
                <li><code>/admin/users/:id</code></li>
                <li><code>/admin/users/:id/edit</code></li>
              </ul>
            </li>
          </ul>
          <p>
            When a user visits <code>/admin/users/123/edit</code>, the <code>:id</code> parameter
            is extracted and passed as <code>params.id</code> to the EditUser component.
          </p>
        </section>
        <section>
          <h3>Navigation</h3>
          <p>
            Use the Link component for declarative navigation or the navigate function for
            programmatic routing:
          </p>
          {Code.format(`
            // Declarative navigation with Link
            <Router.Link to="/users/123">View Profile</Router.Link>

            // Programmatic navigation
            Router.navigate('/users/123')

            // With query parameters
            Router.navigate('/search?q=react&page=2')
          `, 'tsx')}
        </section>
        <section>
          <h2>Best Practices</h2>
          <h3>Route Organization</h3>
          <p>
            The example above demonstrates proper route organization. Notice how more specific
            routes are defined before general ones:
          </p>
          <ul>
            <li><code>/admin/users/:id/edit</code> comes before <code>/admin/users/:id</code></li>
            <li><code>/admin/users/:id</code> comes before <code>/admin</code></li>
            <li>This ensures the most specific match is found first</li>
          </ul>
          <p>
            Always use the Switch component to ensure only one route renders at a time.
          </p>
        </section>
        <section>
          <h3>Parameter Validation</h3>
          <p>
            Always validate route parameters before using them, especially for dynamic routes.
            The function-based routes in our example should include validation:
          </p>
          {Code.format(`
            <Router.Route template="/users/:id">
              {params => {
                const userId = parseInt(params.id, 10)
                if (isNaN(userId) || userId <= 0) {
                  return <ErrorPage message="Invalid user ID" />
                }
                return <UserProfile id={userId} />
              }}
            </Router.Route>
          `, 'tsx')}
        </section>
        <section>
          <h3>Active Link States</h3>
          <p>
            Link components automatically track their active state based on the current route.
            Use this to highlight the current navigation item:
          </p>
          {Code.format(`
            // Link automatically gets data-active="true" when active
            <Router.Link to="/dashboard">
              Dashboard
            </Router.Link>

            // CSS can target the active state
            .link.component[data-active="true"] {
              background-color: #007bff;
              color: white;
              font-weight: bold;
            }
          `, 'tsx')}
        </section>
        <section>
          <h3>Component Architecture</h3>
          <p>Router and Link extend the Component base class, which provides:</p>
          <ul>
            <li>
              <strong>Consistent Structure:</strong> All routing components follow the same pattern
              for props, state, and lifecycle management
            </li>
            <li>
              <strong>Type Safety:</strong> Full TypeScript support with proper prop validation
              and route parameter typing
            </li>
            <li>
              <strong>History Integration:</strong> Seamless integration with browser history
              and popstate events
            </li>
            <li>
              <strong>Event System:</strong> Custom NavigateEvent for cross-component communication
            </li>
          </ul>
        </section>
        <section>
          <h3>Benefits</h3>
          <ul>
            <li>Declarative route definitions</li>
            <li>Automatic parameter extraction</li>
            <li>Browser history integration</li>
            <li>Type-safe route parameters</li>
            <li>Active link state tracking</li>
            <li>Programmatic navigation support</li>
            <li>Consistent with library design principles</li>
            <li>Lightweight and performant</li>
          </ul>
        </section>
      </>
    )
  }
}
