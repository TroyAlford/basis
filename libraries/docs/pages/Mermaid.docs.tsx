import { Mermaid } from '../../react/components/Mermaid/Mermaid'
import { Theme } from '../../react/components/Theme/Theme'
import { BeautifulMermaid } from '../components/BeautifulMermaid'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

/** Diagram types beautiful-mermaid also renders, for the renderer comparison. */
const SHARED_TITLES = new Set(['Class', 'Entity relationship', 'Flowchart', 'Sequence', 'State'])

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
          <p>Diagrams are painted from the surrounding Basis design tokens — the primary color, background, foreground, and font — so they follow the active <code>Theme</code>. Basis deliberately ships no Mermaid-specific look API: to change how diagrams look, change the <code>Theme</code> around them.</p>
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
          <h2>Theming</h2>
          <p>A diagram is themed from the design tokens in scope where it renders, so wrapping it in a <code>Theme</code> is the whole customization surface. Render the <code>Theme</code> with a <code>name</code>, then put the diagram in that scope — the component’s <code>theme</code> prop sets <code>data-theme</code> for you.</p>
          <div data-theme-example="default">
            <h3>Default theme</h3>
            <Mermaid>{FLOWCHART}</Mermaid>
          </div>
          <Theme
            name="diagram-dusk"
            color={{
              background: '#0f172a',
              foreground: '#e2e8f0',
              primary: '#38bdf8',
            }}
          />
          <div data-theme-example="named">
            <h3>A named theme</h3>
            <p>The same diagram inside <code>&lt;Mermaid theme=&quot;diagram-dusk&quot;&gt;</code>:</p>
            <Mermaid theme="diagram-dusk">{FLOWCHART}</Mermaid>
          </div>
          {Code.format(`
            import { Mermaid, Theme } from 'basis/react'

            <Theme
              name="diagram-dusk"
              color={{ background: '#0f172a', foreground: '#e2e8f0', primary: '#38bdf8' }}
            />

            <Mermaid theme="diagram-dusk">{\`flowchart TD
              A[Start] --> B[Ship]\`}</Mermaid>
          `)}
        </section>
        <section>
          <h2>Diagram Gallery</h2>
          <p>The component renders any Mermaid diagram type. Each of the following uses the page theme.</p>
          {GALLERY.map(({ source, title }) => (
            <div key={title} data-diagram={title.toLowerCase().replace(/\s+/g, '-')}>
              <h3>{title}</h3>
              <Mermaid>{source}</Mermaid>
            </div>
          ))}
        </section>
        <section>
          <h2>Renderer Comparison</h2>
          <p>An evaluation of the same source through Mermaid and through <code>beautiful-mermaid</code>, both painted from the page tokens. <code>beautiful-mermaid</code> is a lighter renderer with a more restrained look, but it covers fewer diagram types.</p>
          {GALLERY.filter(({ title }) => SHARED_TITLES.has(title)).map(({ source, title }) => (
            <div key={title} data-renderer-comparison={title.toLowerCase().replace(/\s+/g, '-')} style={{ marginBottom: 'var(--basis-unit-lg)' }}>
              <h3>{title}</h3>
              <div style={{ display: 'grid', gap: 'var(--basis-unit-md)', gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <h4>Mermaid</h4>
                  <Mermaid>{source}</Mermaid>
                </div>
                <div>
                  <h4>beautiful-mermaid</h4>
                  <BeautifulMermaid>{source}</BeautifulMermaid>
                </div>
              </div>
            </div>
          ))}
        </section>
        <section>
          <h2>Runtime</h2>
          <p>Diagrams render with Mermaid 12 using the <code>neo</code> look and the <code>elk</code> layout. Fonts, spacing, and the palette come from Basis; there is no separate Mermaid configuration surface to learn.</p>
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
