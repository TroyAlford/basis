import { Mermaid } from '../../react/components/Mermaid/Mermaid'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

export class MermaidDocs extends Documentation<Record<string, never>> {
  content() {
    return (
      <>
        <h1>Mermaid</h1>
        <section>
          <h2>Overview</h2>
          <p>
            The Mermaid component renders a Mermaid diagram. The runtime is imported lazily on mount,
            so a page without diagrams never fetches it and server rendering never reaches the
            network.
          </p>
        </section>
        <section>
          <h2>Basic Usage</h2>
          <p>Pass the diagram source as the component's text:</p>
          {Code.format(`
        import { Mermaid } from '@basis/react'

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
          <h2>In Markdown and MDX</h2>
          <p>
            A <code>mermaid</code> code fence in a <code>.mdx</code> document compiles to this
            component, so diagram source written as Markdown renders as a diagram.
          </p>
        </section>
      </>
    )
  }
}
