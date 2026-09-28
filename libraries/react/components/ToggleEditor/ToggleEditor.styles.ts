import { css, style } from '../../utilities/style'

style('basis:toggle-editor', css`
  .toggle.editor {
    align-items: center;
    background: transparent;
    border: 1px solid #8886;
    border-radius: var(--basis-radius-sm);
    cursor: pointer;
    display: inline-flex;
    gap: 0.25em;
    padding: 0.5em;
    transition: background-color 0.15s ease;
    user-select: none;

    &[data-state="on"] {
      background: var(--basis-color-primary);
      color: var(--basis-color-contrast);
    }
  }
`)
