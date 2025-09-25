import { Pin } from '@basis/react/types/Pin'
import { css, style } from '../../utilities/style'

style('basis:table', css`
  :root {
    --basis-table-border-color: #8888;
    --basis-table-header-cell-background: var(--basis-color-primary);
    --basis-table-header-cell-foreground: var(--basis-color-contrast);
    --basis-table-header-row-z: 2;
    --basis-table-row-background-even: #ddd;
    --basis-table-row-background-odd: var(--basis-color-background);
    --basis-table-row-height: 2em;
    --basis-table-row-hover-color: var(--basis-color-primary);
  }

  .table.editor.component {
    border-color: var(--basis-table-border-color);
    overflow: auto;
    padding: 0;
    position: relative;

    > table {
      border-collapse: separate;
      border-spacing: 0;
      width: 100%;

      thead tr {
        background-color: var(--basis-table-header-cell-background);
        height: var(--basis-table-row-height);
        isolation: isolate;
        position: sticky;
        top: 0;
        z-index: var(--basis-table-header-row-z);
      }
      
      th, td {
        height: var(--basis-table-row-height);
        &[data-pin="${Pin.Left}"], &[data-pin="${Pin.Right}"] {
          background-color: inherit;
        }
      }

      tbody {
        background-color: var(--basis-table-row-background-odd);

        tr {
          height: var(--basis-table-row-height);
          position: relative;

          &:nth-child(odd) {
            background-color: var(--basis-table-row-background-odd);
          }
          &:nth-child(even) {
            background-color: #8883;
          }

          &:hover > :is(td, th):after {
            background-color: var(--basis-table-row-hover-color);
            content: '';
            inset: 0;
            opacity: 0.2;
            pointer-events: none;
            position: absolute;
            z-index: var(--basis-table-header-row-z);
          }
        }
      }
    }
  }
`)
