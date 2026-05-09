import { css, style } from '../../utilities/style'

style('basis:overlay-provider:notifications', css`
  .notifications.component {
    display: flex;
    flex-direction: column;
    padding: 1em;
    pointer-events: none;
    position: fixed;
    inset: 0;
    gap: .5em;

    > * {
      pointer-events: auto;
    }
  }
`)
