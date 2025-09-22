import { TextAlign } from '../../types/TextAlign'
import { css, style } from '../../utilities/style'

style('basis:table-cell', css`
  :root {
    --basis-table-cell-padding: 0 .5em;
    --basis-table-cell-background: var(--basis-color-background);
    --basis-table-cell-foreground: var(--basis-color-foreground);
  }

  .table-cell.component {
    color: var(--basis-table-cell-foreground);
    isolation: isolate;
    padding: var(--basis-table-cell-padding);
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
      border: none;
      margin: 0;
      padding: 0;

      > .value {
        white-space: nowrap;
      }
    }
  }
`)
