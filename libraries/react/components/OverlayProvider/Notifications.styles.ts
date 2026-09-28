import { css, style } from '../../utilities/style'

style('basis:overlay-provider:notifications', css`
  .notifications.component {
    display: flex;
    flex-direction: column;
    gap: .5em;
    inset: 0;
    padding: 1em;
    pointer-events: none;
    position: fixed;

    > * {
      pointer-events: auto;
    }
  }
`)
