import { Orientation } from '../../types/Orientation'
import { css, style } from '../../utilities/style'

// Base Menu styles for inline menus
style('basis:menu', css`
  .menu.component {
    color: var(--basis-color-foreground);
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
      background-color: transparent;
      color: inherit;
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

      &:hover:not([disabled]) {
        background-color: var(--basis-color-hover);
      }

      &[aria-selected="true"] {
        background-color: var(--basis-color-selection);
      }

      &:focus-visible {
        outline: 1px solid var(--basis-color-focus);
        outline-offset: -1px;
      }
    }

    > .menu-divider.component {
      background-color: var(--basis-color-foreground);
      border: none;
      opacity: 0.2;

      + .menu-divider.component, &:first-child, &:last-child {
        display: none;
      }
    }

    &[data-orientation='${Orientation.Vertical}'] > .menu-divider.component {
      height: 1px;
      margin: 0.25em 0;
    }

    &[data-orientation='${Orientation.Horizontal}'] > .menu-divider.component {
      margin: 0 0.25em;
      width: 1px;
    }
  }
`)
