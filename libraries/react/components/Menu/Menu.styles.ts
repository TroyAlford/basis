import { Orientation } from '../../types/Orientation'
import { css, style } from '../../utilities/style'

// Base Menu styles for inline menus
style('basis:menu', css`
  .menu.component {
    display: flex;
    list-style: none;
    margin: 0;
    padding: 0;

    [disabled] &, &[disabled] {
      background-color: var(--basis-color-disabled);
      color: var(--basis-color-disabled-text);
      cursor: default;
    }

    &[data-orientation='${Orientation.Horizontal}'] { flex-direction: row; }
    &[data-orientation='${Orientation.Vertical}'] { flex-direction: column; }

    > .menu-item.component {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      flex-direction: row;
      justify-content: flex-start;
      line-height: 1em;
      margin: 0;
      padding: .5em;
      white-space: nowrap;

      [disabled] &, &[disabled] {
        background-color: var(--basis-color-disabled);
        color: var(--basis-color-disabled-text);
        cursor: default;
      }

      &:focus {
        outline: 1px solid var(--basis-color-primary);
        outline-offset: -1px;
      }
    }

    > .menu-divider.component {
      background-color: var(--basis-color-foreground);
      border: none;
      height: 1px;
      margin: 0.25em 0;
      opacity: 0.2;
    }
  }
`)
