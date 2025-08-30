import * as React from 'react'
import { Tag } from '../../react/components/Tag/Tag'
import { Code } from '../components/Code'

export const TagDocs = () => (
  <>
    <h1>Tag</h1>
    <section>
      <h2>Overview</h2>
      <p>
        The Tag component displays a labeled element that can optionally be removed.
        Tags are commonly used to show categories, labels, or selected items.
      </p>
    </section>
    <section>
      <h2>Basic Usage</h2>
      <p>Simple tag display:</p>
      {Code.format(`
        import { Tag } from '@basis/react'

        <Tag>JavaScript</Tag>
        <Tag>React</Tag>
        <Tag>TypeScript</Tag>
      `)}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
        <Tag>JavaScript</Tag>
        <Tag>React</Tag>
        <Tag>TypeScript</Tag>
        <Tag>CSS</Tag>
      </div>
    </section>
    <section>
      <h2>Removable Tags</h2>
      <p>Tags with remove functionality:</p>
      {Code.format(`
        <Tag
          removable
          onRemove={() => console.log('Tag removed')}
        >
          Removable Tag
        </Tag>
      `)}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
        <Tag removable onRemove={() => alert('Tag 1 removed!')}>Tag 1</Tag>
        <Tag removable onRemove={() => alert('Tag 2 removed!')}>Tag 2</Tag>
        <Tag removable onRemove={() => alert('Tag 3 removed!')}>Tag 3</Tag>
      </div>
    </section>
  </>
)
