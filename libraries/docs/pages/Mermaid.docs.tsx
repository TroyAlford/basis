import { Mermaid } from '../../react/components/Mermaid/Mermaid'
import { Theme } from '../../react/components/Theme/Theme'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

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
    +source
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
    source: `xychart-beta
  title "Monthly revenue"
  x-axis [Jan, Feb, Mar, Apr, May, Jun]
  y-axis "Revenue" 0 --> 500
  bar [180, 250, 310, 280, 350, 420]
  line [180, 230, 300, 290, 360, 430]`,
    title: 'XY chart',
  },
]

export class MermaidDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <h1>Mermaid</h1>
        <section>
          <h2>Overview</h2>
          <p>The Mermaid component renders Mermaid source with <code>beautiful-mermaid</code>. Rendering is synchronous and DOM-free, so server rendering emits the final SVG — there is no lazy runtime, no client bootstrap, and no network at render time.</p>
          <p>Diagrams are painted from the surrounding Basis design tokens — the primary color, background, foreground, and font — so they follow the active <code>Theme</code>. Basis ships no Mermaid-specific look API: to change how diagrams look, change the <code>Theme</code> around them.</p>
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
          <p>Every diagram type the renderer supports, painted from the page theme.</p>
          {GALLERY.map(({ source, title }) => (
            <div key={title} data-diagram={title.toLowerCase().replace(/\s+/g, '-')}>
              <h3>{title}</h3>
              <Mermaid>{source}</Mermaid>
            </div>
          ))}
        </section>
        <section>
          <h2>Supported Diagrams</h2>
          <p><code>beautiful-mermaid</code> renders flowcharts, sequence, class, state, entity-relationship, and XY charts (bar and line). A diagram type it does not recognize falls back to its source, so an unsupported fence never breaks a page.</p>
        </section>
        <section>
          <h2>In Markdown and MDX</h2>
          <p>A <code>mermaid</code> code fence in a <code>.mdx</code> document compiles to this component, and the static docs build renders the SVG at build time, so a built page needs no client runtime.</p>
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
