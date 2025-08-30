import * as React from 'react'
import { Code } from '../components/Code'

export class AwaitDocs extends React.Component {
  render(): React.ReactNode {
    return (
      <>
        <h1>Await</h1>
        <section>
          <p>
            The Await component provides a declarative way to handle asynchronous content rendering
            in React components. Built on the Component base class, it automatically manages the
            loading state and renders content once promises resolve, eliminating the need for
            manual state management of async operations.
          </p>
          <p>
            Await is particularly useful for components that need to render content from dynamic
            imports, API calls, or other asynchronous operations while maintaining a clean,
            declarative API.
          </p>
        </section>
        <section>
          <h3>Basic Usage</h3>
          <p>
            Await accepts a promise as children and renders a fallback while the promise is
            pending. Once resolved, it renders the resolved content:
          </p>
          {Code.format(`
            <Await fallback="Loading...">
              {Promise.resolve("Content loaded!")}
            </Await>
          `)}
        </section>
        <section>
          <h3>Component Architecture</h3>
          <p>
            Await extends the Component base class and provides a simple interface for
            handling asynchronous rendering:
          </p>
          <ul>
            <li><strong>Promise Children:</strong> Accepts a Promise that resolves to React nodes</li>
            <li><strong>Fallback Rendering:</strong> Shows fallback content while promise is pending</li>
            <li><strong>Automatic State Management:</strong> Handles loading state internally</li>
            <li><strong>Lifecycle Integration:</strong> Uses componentDidMount for async operations</li>
          </ul>
        </section>
        <section>
          <h3>Use Cases</h3>
          <p>
            Await is ideal for scenarios where you need to render content that depends on
            asynchronous operations:
          </p>
          <h4>Dynamic Imports</h4>
          <p>Load components or modules dynamically while showing a loading state:</p>
          {Code.format(`
            <Await fallback="Loading component...">
              {import('./HeavyComponent').then(module => <module.HeavyComponent />)}
            </Await>
          `)}
          <h4>API Data Loading</h4>
          <p>
            Render content based on API responses with automatic loading states:
          </p>
          {Code.format(`
            <Await fallback="Fetching data...">
              {fetch('/api/users')
                .then(response => response.json())
                .then(users => <UserList users={users} />)}
            </Await>
          `)}
          <h4>Complex Async Operations</h4>
          <p>
            Handle multiple async operations or complex promise chains:
          </p>
          {Code.format(`
            <Await fallback={<Loading />}>
              {Promise.all([
                fetch('/api/users'),
                fetch('/api/posts')
              ])
                .then(([usersRes, postsRes]) => Promise.all([
                  usersRes.json(),
                  postsRes.json()
                ]))
                .then(([users, posts]) => (
                  <Dashboard users={users} posts={posts} />
                ))}
            </Await>
          `)}
        </section>
        <section>
          <h2>Best Practices</h2>
          <h3>Fallback Design</h3>
          <p>
            Design your fallback content to provide a good user experience during loading:
          </p>
          {Code.format(`
            // Good: Informative fallback
            <Await fallback="Loading user profile...">
              {fetchUserProfile(userId)}
            </Await>

            // Better: Skeleton or placeholder
            <Await fallback={<UserProfileSkeleton />}>
              {fetchUserProfile(userId)}
            </Await>

            // Best: Progress indicator for known operations
            <Await fallback={<ProgressBar progress={0.5} />}>
              {processLargeFile(file)}
            </Await>
          `)}
        </section>
        <section>
          <h3>Error Handling</h3>
          <p>
            Consider error boundaries or error handling for promises that might reject:
          </p>
          {Code.format(`
            <Await fallback="Loading...">
              {fetch('/api/data')
                .then(response => {
                  if (!response.ok) {
                    throw new Error('Failed to fetch data')
                  }
                  return response.json()
                })
                .catch(error => <ErrorMessage error={error} />)}
            </Await>
          `)}
        </section>
        <section>
          <h3>Performance Considerations</h3>
          <p>
            Use Await strategically to avoid unnecessary re-renders and improve performance:
          </p>
          <ul>
            <li><strong>Memoize Promises:</strong> Avoid creating new promises on every render</li>
            <li><strong>Lazy Loading:</strong> Use for components that aren't immediately needed</li>
            <li><strong>Data Fetching:</strong> Ideal for data that can be loaded asynchronously</li>
          </ul>
          {Code.format(`
            // Good: Promise created once
            const userPromise = fetchUser(userId)

            return (
              <Await fallback={<UserSkeleton />}>
                {userPromise}
              </Await>
            )

            // Avoid: Promise created on every render
            return (
              <Await fallback={<UserSkeleton />}>
                {fetchUser(userId)} // This creates a new promise each time
              </Await>
            )
          `)}
        </section>
        <section>
          <h3>Component Integration</h3>
          <p>
            Await works seamlessly with other components and can be nested for complex
            async rendering scenarios:
          </p>
          {Code.format(`
            <div className="dashboard">
              <Await fallback={<HeaderSkeleton />}>
                {fetchHeader()}
              </Await>

              <Await fallback={<ContentSkeleton />}>
                {fetchContent()}
              </Await>

              <Await fallback={<FooterSkeleton />}>
                {fetchFooter()}
              </Await>
            </div>
          `)}
        </section>
        <section>
          <h3>Benefits</h3>
          <ul>
            <li>Declarative async rendering</li>
            <li>Automatic loading state management</li>
            <li>Clean component API</li>
            <li>No manual state management required</li>
            <li>Seamless integration with existing components</li>
            <li>Consistent with library design principles</li>
            <li>Type-safe promise handling</li>
            <li>Built-in lifecycle management</li>
          </ul>
        </section>
      </>
    )
  }
}
