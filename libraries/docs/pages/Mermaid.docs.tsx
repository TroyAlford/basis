import { Mermaid } from '../../react/components/Mermaid/Mermaid'
import type { MermaidVariant } from '../../react/components/Mermaid/theme'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

/** Every look a diagram can be rendered with, in the order the page shows them. */
const VARIANTS: readonly { readonly blurb: string, readonly id: MermaidVariant }[] = [
  { blurb: 'On-brand. The default: Basis tokens with the primary color as the accent.', id: 'basis' },
  { blurb: 'Editorial. A no-color treatment for dense or reference material.', id: 'neutral' },
  { blurb: 'Dark. A high-contrast surface that stands apart from the page.', id: 'dark' },
]

const FLOWCHART = `flowchart TD
  A[Request] --> B{Signed in?}
  B -->|Yes| C[Load profile]
  B -->|No| D[Sign in]
  C --> E[Render]
  D --> E`

const GALLERY: readonly { readonly source: string, readonly title: string }[] = [
  {
    source: `flowchart LR
  Client --> API
  API --> Cache
  API --> Database
  Cache --> API
  Database --> API
  API --> Client`,
    title: 'Flowchart',
  },
  {
    source: `sequenceDiagram
  participant Browser
  participant Server
  participant Store
  Browser->>Server: GET /profile
  Server->>Store: read session
  Store-->>Server: session
  Server-->>Browser: 200 OK`,
    title: 'Sequence',
  },
  {
    source: `classDiagram
  class Component {
    +render()
    #content()
  }
  class Button {
    +variant
    +theme
  }
  class Mermaid {
    +variant
  }
  Component <|-- Button
  Component <|-- Mermaid`,
    title: 'Class',
  },
  {
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: fetch
  Loading --> Ready: resolve
  Loading --> Error: reject
  Error --> Idle: retry
  Ready --> [*]`,
    title: 'State',
  },
  {
    source: `erDiagram
  USER ||--o{ SESSION : opens
  USER {
    string id
    string email
  }
  SESSION {
    string id
    date expiresAt
  }`,
    title: 'Entity relationship',
  },
  {
    source: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  section Design
    Research :done, a1, 2026-01-06, 5d
    Sketch   :active, a2, after a1, 6d
  section Build
    Implement : a3, after a2, 10d
    Test      : a4, after a3, 5d`,
    title: 'Gantt',
  },
  {
    source: `pie showData
  title Where the time goes
  "Features" : 45
  "Tests" : 25
  "Docs" : 15
  "Reviews" : 10
  "Other" : 5`,
    title: 'Pie',
  },
  {
    source: `journey
  title Opening the docs
  section Discover
    Land on the page: 5: Reader
    Find the component: 4: Reader
  section Use
    Copy the example: 5: Reader
    Adapt it: 3: Reader`,
    title: 'User journey',
  },
  {
    source: `timeline
  title Basis releases
  2025 : v1 foundation
  2026 : v5 runtime
       : static docs build`,
    title: 'Timeline',
  },
  {
    source: `gitGraph
  commit id: "init"
  branch feature
  commit id: "scaffold"
  commit id: "tests"
  checkout main
  merge feature
  commit id: "release"`,
    title: 'Git graph',
  },
  {
    source: `mindmap
  root((Basis))
    react
      Component
      Theme
      Mermaid
    server
      static docs
      runtime
    testing
      matchScreenshot`,
    title: 'Mindmap',
  },
  {
    source: `quadrantChart
  title Effort against impact
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Plan
  quadrant-2 Do now
  quadrant-3 Drop
  quadrant-4 Delegate
  Auth: [0.2, 0.8]
  Docs: [0.7, 0.6]
  Polish: [0.4, 0.3]`,
    title: 'Quadrant',
  },
]

export class MermaidDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <h1>Mermaid</h1>
        <section>
          <h2>Overview</h2>
          <p>The Mermaid component renders a Mermaid diagram. The runtime is imported lazily on mount, so a page without diagrams never fetches it and server rendering never reaches the network.</p>
          <p>Diagrams are themed from the surrounding Basis design tokens — the primary color, background, foreground, radius, and font — so they follow the active <code>Theme</code> instead of Mermaid’s stock palette. Use the <code>variant</code> prop to choose one of the named looks.</p>
        </section>
        <section>
          <h2>Basic Usage</h2>
          <p>Pass the diagram source as the component’s text:</p>
          {Code.format(`
        import { Mermaid } from 'basis/react'

        <Mermaid>{\`flowchart TD
          A[Start] --> B{Ready?}
          B -->|Yes| C[Ship]
          B -->|No| A\`}</Mermaid>
      `)}
          <Mermaid>
            {`flowchart TD
              A[Start] --> B{Ready?}
              B -->|Yes| C[Ship]
              B -->|No| A`}
          </Mermaid>
        </section>
        <section>
          <h2>Theme Variants</h2>
          <p>The <code>variant</code> prop selects one of four looks. Every look derives its palette from the same Basis tokens, so a custom primary color flows through all of them.</p>
          {VARIANTS.map(({ blurb, id }) => (
            <div key={id} data-variant-section={id}>
              <h3><code>variant=&quot;{id}&quot;</code></h3>
              <p>{blurb}</p>
              <Mermaid variant={id}>{FLOWCHART}</Mermaid>
            </div>
          ))}
        </section>
        <section>
          <h2>Diagram Gallery</h2>
          <p>The component renders any Mermaid diagram type. Each of the following uses the default <code>basis</code> look.</p>
          {GALLERY.map(({ source, title }) => (
            <div key={title} data-diagram={title.toLowerCase().replace(/\s+/g, '-')}>
              <h3>{title}</h3>
              <Mermaid>{source}</Mermaid>
            </div>
          ))}
        </section>
        <section>
          <h2>Props</h2>
          <h3><code>variant</code></h3>
          <p>Optional. One of <code>basis</code> (default), <code>neutral</code>, or <code>dark</code>. The variant controls the Mermaid theme only; the container follows the page.</p>
          {Code.format(`
            <Mermaid variant="dark">{\`sequenceDiagram
              A->>B: Hello
              B-->>A: Hi\`}</Mermaid>
          `)}
        </section>
        <section>
          <h2>In Markdown and MDX</h2>
          <p>A <code>mermaid</code> code fence in a <code>.mdx</code> document compiles to this component, so diagram source written as Markdown renders as a diagram with the same default look.</p>
          {Code.format(`
            \`\`\`mermaid
            flowchart LR
              Draft --> Review --> Publish
            \`\`\`
          `, 'mdx')}
        </section>
      </>
    )
  }
}
