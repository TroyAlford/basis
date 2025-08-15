import { css, style } from '../../utilities/style'

style('basis:tag', css`
  .tag.component {
    align-items: center;
    border: 1px solid currentColor;
    border-radius: .25em;
    color: currentColor;
    display: inline-flex;
    font-size: .8em;
    gap: .1em;
    line-height: 1;
    padding: .1em .25em;
    height: min-content;
    white-space: nowrap;

    &[data-theme] {
      color: var(--basis-color-primary);
    }

    > .content {
      color: currentColor;
      flex: 1;
    }

    > .remove {
      align-items: center;
      color: currentColor;
      cursor: pointer;
      display: flex;
      font-weight: bold;
      height: 1em;
      justify-content: center;
      text-decoration: none;
      padding: 0;
      width: 1em;

      &:focus {
        outline: 2px solid currentColor;
      }
    }
  }
`)
