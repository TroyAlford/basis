import * as React from 'react'
import { Tag } from '@basis/react'
import { TagsEditor } from '../../react/components/TagsEditor/TagsEditor'
import { Code } from '../components/Code'

export const TagsEditorDocs = () => (
  <>
    <h1>TagsEditor</h1>
    <section>
      <h2>Overview</h2>
      <p>
        The TagsEditor component allows users to add and remove tags from a list.
        It provides an input field for adding new tags and displays existing tags with remove functionality.
      </p>
    </section>
    <section>
      <h2>Basic Usage</h2>
      <p>Simple tag management:</p>
      {Code.format(`
        import { TagsEditor } from '@basis/react'

        const [tags, setTags] = useState(['react', 'typescript'])

        <TagsEditor
          initialValue={tags}
          onChange={setTags}
          placeholder="Add tags..."
        />
      `)}
      <p>
        <strong>Keyboard shortcuts:</strong> Press <Tag>Enter</Tag> to add the current input as a tag,
        or <Tag>Backspace</Tag> when the input is empty to remove the last tag.
      </p>
      <div style={{ marginTop: '1rem' }}>
        <TagsEditor
          initialValue={['react', 'typescript', 'ui']}
          placeholder="Add tags..."
        />
      </div>
    </section>
    <section>
      <h2>Deny List</h2>
      <p>Prevent specific tags from being added:</p>
      {Code.format(`
        <TagsEditor
          initialValue={tags}
          deny={['forbidden', 'blocked', 'denied']}
          placeholder="Add tags (some are forbidden)..."
        />
      `)}
      <div style={{ marginTop: '1rem' }}>
        <TagsEditor
          deny={['forbidden', 'blocked', 'denied']}
          initialValue={['allowed', 'permitted']}
          placeholder="Add tags (some are forbidden)..."
        />
      </div>
    </section>
    <section>
      <h2>Read Only Mode</h2>
      <p>Display tags without editing:</p>
      {Code.format('<TagsEditor initialValue={tags} readOnly />')}
      <TagsEditor readOnly initialValue={['react', 'typescript', 'ui']} />
    </section>
    <section>
      <h2>Custom Tag Rendering</h2>
      <p>Customize how individual tags are displayed:</p>
      {Code.format(`
        <TagsEditor
          initialValue={tags}
          onChange={setTags}
          tag={tag => (
            <div style={{ background: '#369', color: 'white' }}>🏷️ {tag}</div>
          )}
          placeholder="Add custom tags..."
        />
      `)}
      <div style={{ marginTop: '1rem' }}>
        <TagsEditor
          initialValue={['custom', 'styled', 'tags']}
          placeholder="Add custom tags..."
          tag={tag => (
            <div style={{ background: '#369', color: 'white' }}>🏷️ {tag}</div>
          )}
        />
      </div>
    </section>
  </>
)
