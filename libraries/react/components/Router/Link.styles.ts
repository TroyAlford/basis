import { css, style } from '../../utilities/style'

style('basis:router:link', css`
  .link.component {
    color: var(--basis-color-primary);
    text-decoration: none;

    &[data-active='true'] {
      color: var(--basis-color-primary);
      cursor: default;
      font-weight: bold;
    }
  }
`)
