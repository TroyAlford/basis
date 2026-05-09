import { css, style } from '../../utilities/style'

style('basis:overlay-provider:notifications', css`
  .notifications.component {
    padding: 1em;
    pointer-events: none;
    position: fixed;
    inset: 0;

    > * {
      pointer-events: auto;
    }
  }
`)
