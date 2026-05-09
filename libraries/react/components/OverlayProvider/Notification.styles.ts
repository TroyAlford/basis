import { css, style } from '../../utilities/style'

style('basis:notification', css`
  .notification.component {
    border: 1px solid currentColor;
    border-radius: 0.25em;
    display: flex;
    flex-direction: row;
    gap: 0.5em;
    padding: 0.5em;
  }
`)
