import { TextAlign } from '../../types/TextAlign'
import { css, style } from '../../utilities/style'

style('basis:table-cell', css`
  .table-cell.component {
    background-color: var(--basis-table-cell-background, transparent);
    color: var(--basis-table-cell-foreground, var(--basis-color-foreground));
    isolation: isolate;
    padding: var(--basis-table-cell-padding, 0 .5em);
    white-space: nowrap;

    ${Object.values(TextAlign).map(align => (css`
    &[data-align="${align}"] {
      &, > .editor, > .editor > .value {
        justify-content: ${align};
        text-align: ${align};
      }
    }
    `)).join('\n')}

    > .text-editor, > .number-editor {
      background-color: transparent;
      border: none;
      margin: 0;
      padding: 0;

      > .value {
        white-space: nowrap;
      }
    }
  }
`)
