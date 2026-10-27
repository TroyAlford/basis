import { Pin } from '../../types/Pin'
import { css, style } from '../../utilities/style'

style('basis:table', css`
  .table.editor.component {
    border-color: var(--basis-table-border-color, var(--basis-color-border-subtle));
    isolation: isolate;
    overflow: auto;
    padding: 0;
    position: relative;

    > table {
      border-collapse: separate;
      border-spacing: 0;
      width: 100%;

      thead {
        /*
         * Table-row z-index is not honored consistently across Chromium, so
         * the row group owns the sticky layer above pinned body cells.
         */
        position: sticky;
        top: 0;
        z-index: 2;
        tr {
          background-color: var(--basis-table-header-cell-background, var(--basis-color-primary));
          height: var(--basis-table-row-height, 2em);
        }
      }
      
      th, td {
        height: var(--basis-table-row-height, 2em);
        &[data-pin="${Pin.Left}"], &[data-pin="${Pin.Right}"] {
          /*
           * Pinned cells inherit their row's background. The row backgrounds
           * must be opaque so scrolled content cannot show through the pins.
           */
          background-color: inherit;
        }
      }

      tbody {
        background-color: var(--basis-table-row-background-odd, var(--basis-color-surface));

        tr {
          height: var(--basis-table-row-height, 2em);
          position: relative;

          &:nth-child(odd) {
            background-color: var(--basis-table-row-background-odd, var(--basis-color-surface));
          }
          &:nth-child(even) {
            background-color: var(--basis-table-row-background-even, var(--basis-color-surface-alt));
          }

          &:hover > :is(td, th):after {
            background-color: var(--basis-table-row-hover-color, var(--basis-color-primary));
            content: '';
            inset: 0;
            opacity: 0.2;
            pointer-events: none;
            position: absolute;
            z-index: 2;
          }
        }
      }
    }
  }
`)
