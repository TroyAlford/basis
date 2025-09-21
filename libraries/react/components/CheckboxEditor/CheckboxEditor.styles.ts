import { css, style } from '../../utilities/style'

export const CheckboxEditorStyles = style('basis:checkbox-editor', css`
  .checkbox-editor.editor {
    --basis-icon-size: 1.25em;

    align-items: center;
    cursor: pointer;
    display: inline-flex;
    gap: 0.25em;
    user-select: none;

    > input[type="checkbox"] { display: none; }

    &:focus-within {
      outline: 2px solid var(--basis-focus-color);
      outline-offset: 2px;
    }

    &[disabled], &[readonly] {
      pointer-events: none;
    }
  }
`)
