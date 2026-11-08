import { Mermaid } from '../../react/components/Mermaid/Mermaid'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'
import { authoringLogicalErd, authoringPhysicalErd, authoringSchema, authoringTypes } from '../generated/Authoring.generated.ts'

export class AuthoringDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <section>
          <h1>Typed Authoring & Generated Products</h1>
          <p>Canonical definitions can be authored as typed TypeScript without changing validation. <code>defineEntities</code> serializes the typed document and runs it through the same <code>EntityDefinitions.load</code> validator used for canonical JSON.</p>
          {Code.format(`
            import { Cardinality, FieldType, defineEntities } from 'basis/server'

            export default defineEntities({
              entities: [
                {
                  name: 'User',
                  fields: [
                    { field: 'email', type: FieldType.String },
                    {
                      field: 'notes',
                      type: FieldType.Inverse,
                      target: 'Note',
                      inverse: 'owner',
                      cardinality: Cardinality.Many,
                    },
                  ],
                },
                {
                  name: 'Note',
                  fields: [
                    { field: 'title', type: FieldType.String },
                    { field: 'owner', type: FieldType.Entity, target: 'User', inverse: 'notes' },
                    { field: 'tags', type: FieldType.Array, items: { type: FieldType.String } },
                    { field: 'metadata', type: FieldType.JSON },
                  ],
                },
              ],
            })
          `)}
          <p>The typed declaration accepts the same entity, relationship, array, JSON, reference, inverse, MTI, and identity-format shapes as canonical JSON. There is no decorator syntax, second registry, or alternative validator.</p>
        </section>
        <section>
          <h2>Generated TypeScript</h2>
          <p>These examples are rendered from the live <code>generateProducts</code> result for the declaration above; they are not copied snapshots.</p>
          {Code.format(authoringTypes)}
        </section>
        <section>
          <h2>Generated JSON Schema</h2>
          <p>The output schema for <code>Note</code>:</p>
          {Code.format(authoringSchema)}
        </section>
        <section>
          <h2>Logical ERD</h2>
          <Mermaid>{authoringLogicalErd}</Mermaid>
        </section>
        <section>
          <h2>Physical ERD</h2>
          <Mermaid>{authoringPhysicalErd}</Mermaid>
        </section>
        <section>
          <h2>Authoring Conventions</h2>
          <ul>
            <li><code>User</code> extends the universal <code>Entity</code> root and does not redeclare its identity fields.</li>
            <li><code>Role</code> uses the root identity and entity name, with an optional description.</li>
            <li>Use entity-reference fields for stored references and inverse fields for reciprocal navigation.</li>
            <li>Use <code>Cardinality.One</code> or <code>Cardinality.Many</code> on inverse declarations.</li>
            <li>Keep generated files generated. Edit the canonical authoring source, then regenerate.</li>
          </ul>
          <p>See <a href="/server/schema">Schema Inspection &amp; Planning</a> for the physical compiler and migration workflow.</p>
        </section>
      </>
    )
  }
}
