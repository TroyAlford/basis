import { css, style } from '../../utilities/style'

import.meta.hot.accept()

style('basis:checkbox-editor', css`
  .checkbox-editor.editor {
    --basis-icon-size: 1.25em;

    align-items: center;
    cursor: pointer;
    display: inline-flex;
    gap: 0.25em;
    position: relative;
    user-select: none;

    > input[type="checkbox"] {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      margin: -1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }

    &:focus-within {
      outline: 2px solid var(--basis-focus-color);
      outline-offset: 2px;
    }

    &[disabled], &[readonly] {
      pointer-events: none;
    }
  }
`)
