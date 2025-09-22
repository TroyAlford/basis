import { SortBy } from '../../types/SortBy'
import { TextAlign } from '../../types/TextAlign'
import { css, style } from '../../utilities/style'

style('basis:table-header-cell', css`
  :root {
    --basis-table-header-cell-foreground: var(--basis-color-contrast);
    --basis-table-header-cell-padding: var(--basis-table-cell-padding);
  }

  .table-header-cell.component {
    background-color: inherit;
    border-bottom: 1px solid var(--basis-table-border-color);
    color: var(--basis-table-header-cell-foreground);
    isolation: isolate;

    > .content {
      align-items: center;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      padding: var(--basis-table-header-cell-padding);

      > .title {
        flex: 1;
        overflow: hidden;
        user-select: none;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      > .sort.icon[data-sort-by="${SortBy.None}"] {
        visibility: hidden;
      }

      &:hover, &:focus, &:focus-within {
        > .sort.icon[data-sort-by="${SortBy.None}"] {
          visibility: visible;
        }
      }
    }
    
    &[data-sortable="true"] {
      cursor: pointer;
    }
    &[data-align="${TextAlign.Center}"] > .content > .title { text-align: center; }
    &[data-align="${TextAlign.Left}"] > .content > .title { text-align: left; }
    &[data-align="${TextAlign.Right}"] > .content > .title { text-align: right; }
  }
`)
